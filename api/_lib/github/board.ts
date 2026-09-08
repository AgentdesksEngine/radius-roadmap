/**
 * The one place that knows how the (now retired) GitHub Project was shaped.
 *
 * Kept only as the read path for the one-off Supabase migration (scripts/migrate-github-to-
 * supabase.ts) and the dump-schema/provision-fields dev scripts — the live app routes under
 * api/ no longer import this module (see api/_lib/db/board.ts instead). Deleted in Phase 4 of
 * the cutover plan once the migration is done.
 *
 * Its types are intentionally local (GitHub* prefixed) rather than imported from
 * shared/types.ts: that file now describes the Postgres-backed app contract (id-based
 * `GitHubPerson`, `assigneeIds`, ...), which no longer matches GitHub's login-based shapes.
 */
import type {
  FieldOption,
  FieldValue,
  FieldWriteValue,
  IssueState,
  IssueStateReason,
  ProjectField,
  ProjectSchema,
  Reaction,
  ReactionContent,
} from '../../../shared/types';
import { env } from '../env';
import { HttpError } from '../http';
import type { GitHubClient } from './gql';

export interface GitHubPerson {
  login: string;
  avatarUrl: string;
  name?: string | null;
}

export interface GitHubIssueRef {
  id: string;
  number: number;
  key: string;
  title: string;
  state: IssueState;
  stateReason: IssueStateReason | null;
  url: string;
  assignees: GitHubPerson[];
}

export interface GitHubSubIssueProgress {
  total: number;
  completed: number;
  percent: number;
}

export interface GitHubBoardItem {
  itemId: string;
  issueId: string;
  number: number;
  key: string;
  title: string;
  body: string;
  state: IssueState;
  stateReason: IssueStateReason | null;
  url: string;
  repository: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  author: GitHubPerson | null;
  assignees: GitHubPerson[];
  labels: { name: string; color: string }[];
  commentCount: number;
  isArchived: boolean;
  parent: GitHubIssueRef | null;
  subIssues: GitHubSubIssueProgress;
  reactions: Reaction[];
  fields: Record<string, FieldValue>;
}

export interface GitHubBoardData {
  items: GitHubBoardItem[];
  fetchedAt: string;
}

export interface GitHubIssueComment {
  id: string;
  body: string;
  createdAt: string;
  author: GitHubPerson | null;
  reactions: Reaction[];
}

export type GitHubActivityKind =
  | 'comment'
  | 'closed'
  | 'reopened'
  | 'assigned'
  | 'unassigned'
  | 'labeled'
  | 'unlabeled'
  | 'renamed'
  | 'status'
  | 'referenced'
  | 'sub-issue-added'
  | 'sub-issue-removed'
  | 'parent-added'
  | 'parent-removed'
  | 'duplicate';

export interface GitHubActivityEvent {
  id: string;
  kind: GitHubActivityKind;
  createdAt: string;
  actor: GitHubPerson | null;
  body?: string;
  reactions?: Reaction[];
  detail?: string;
  from?: string;
  to?: string;
  url?: string;
}

export interface GitHubOrgMember {
  id: string;
  login: string;
  avatarUrl: string;
  name?: string | null;
}

export interface GitHubCreateIssueRequest {
  title: string;
  body?: string;
  fields?: Record<string, FieldWriteValue>;
  assigneeLogins?: string[];
  labelNames?: string[];
}

export interface GitHubBulkResult {
  items: GitHubBoardItem[];
  failed: { itemId: string; error: string }[];
}

// ---------- GraphQL documents ----------

const FIELD_COMMON = `... on ProjectV2FieldCommon { id name dataType }`;
const REACTIONS = `reactionGroups { content viewerHasReacted reactors { totalCount } }`;
const ISSUE_REF = `id number title state stateReason url assignees(first: 5) { nodes { login avatarUrl name } }`;
const ACTOR = `actor { login avatarUrl }`;

export const SCHEMA_QUERY = /* GraphQL */ `
  query Schema($org: String!, $number: Int!, $repo: String!) {
    organization(login: $org) {
      projectV2(number: $number) {
        id
        title
        url
        fields(first: 50) {
          nodes {
            __typename
            ${FIELD_COMMON}
            ... on ProjectV2SingleSelectField { options { id name color description } }
            ... on ProjectV2MultiSelectField { multiSelectOptions { id name color description } }
          }
        }
      }
      repository(name: $repo) {
        id
        name
        nameWithOwner
        labels(first: 100) { nodes { id name color } }
      }
    }
  }
`;

const ITEM_FRAGMENT = /* GraphQL */ `
  fragment ItemFields on ProjectV2Item {
    id
    updatedAt
    isArchived
    fieldValues(first: 30) {
      nodes {
        __typename
        ... on ProjectV2ItemFieldSingleSelectValue { optionId name field { ${FIELD_COMMON} } }
        ... on ProjectV2ItemFieldMultiSelectValue { options { id name } field { ${FIELD_COMMON} } }
        ... on ProjectV2ItemFieldDateValue { date field { ${FIELD_COMMON} } }
        ... on ProjectV2ItemFieldTextValue { text field { ${FIELD_COMMON} } }
        ... on ProjectV2ItemFieldNumberValue { number field { ${FIELD_COMMON} } }
        ... on ProjectV2ItemFieldIterationValue { iterationId title startDate duration field { ${FIELD_COMMON} } }
      }
    }
    content {
      __typename
      ... on Issue {
        id
        number
        title
        body
        state
        stateReason
        url
        createdAt
        updatedAt
        closedAt
        author { login avatarUrl }
        assignees(first: 10) { nodes { login avatarUrl name } }
        labels(first: 20) { nodes { name color } }
        comments { totalCount }
        repository { nameWithOwner }
        parent { ${ISSUE_REF} }
        subIssuesSummary { total completed percentCompleted }
        ${REACTIONS}
      }
    }
  }
`;

export const ITEMS_QUERY = /* GraphQL */ `
  ${ITEM_FRAGMENT}
  query Items($org: String!, $number: Int!, $after: String) {
    organization(login: $org) {
      projectV2(number: $number) {
        items(first: 100, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ...ItemFields
          }
        }
      }
    }
  }
`;

/**
 * Everything that changed since a timestamp, as project items.
 *
 * GraphQL cost comes from the page sizes you *ask* for, not what comes back, so this is
 * deliberately narrow: 25 issues by 2 project items measures at 2 rate-limit points, where
 * a full board refresh of ~1,000 issues is 40. `projectItems` is 2 rather than 1 so an
 * issue that also sits on some other project still yields its item on this one.
 *
 * It cannot see an item *removed* from the project, which is why the cache still does a
 * periodic full refresh.
 */
const DELTA_QUERY = /* GraphQL */ `
  ${ITEM_FRAGMENT}
  query Delta($org: String!, $repo: String!, $since: DateTime!, $after: String) {
    organization(login: $org) {
      repository(name: $repo) {
        issues(
          first: 25
          after: $after
          filterBy: { since: $since }
          orderBy: { field: UPDATED_AT, direction: DESC }
        ) {
          pageInfo { hasNextPage endCursor }
          nodes {
            projectItems(first: 2) {
              nodes {
                project { id }
                ...ItemFields
              }
            }
          }
        }
      }
    }
  }
`;

const ITEM_QUERY = /* GraphQL */ `
  ${ITEM_FRAGMENT}
  query Item($id: ID!) {
    node(id: $id) {
      ...ItemFields
    }
  }
`;

const ISSUE_PROJECT_ITEMS_QUERY = /* GraphQL */ `
  query IssueItems($id: ID!) {
    node(id: $id) {
      ... on Issue {
        projectItems(first: 20) {
          nodes {
            id
            project {
              id
            }
          }
        }
      }
    }
  }
`;

const COMMENTS_QUERY = /* GraphQL */ `
  query Comments($id: ID!) {
    node(id: $id) {
      ... on Issue {
        comments(first: 100) {
          nodes { id body createdAt author { login avatarUrl } ${REACTIONS} }
        }
      }
    }
  }
`;

const MEMBERS_QUERY = /* GraphQL */ `
  query Members($org: String!, $after: String) {
    organization(login: $org) {
      membersWithRole(first: 100, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          login
          avatarUrl
          name
        }
      }
    }
  }
`;

const SET_FIELD_MUTATION = /* GraphQL */ `
  mutation SetField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
    updateProjectV2ItemFieldValue(
      input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }
    ) {
      projectV2Item {
        id
      }
    }
  }
`;

const CLEAR_FIELD_MUTATION = /* GraphQL */ `
  mutation ClearField($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
    clearProjectV2ItemFieldValue(
      input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }
    ) {
      projectV2Item {
        id
      }
    }
  }
`;

const CREATE_ISSUE_MUTATION = /* GraphQL */ `
  mutation CreateIssue(
    $repositoryId: ID!
    $title: String!
    $body: String
    $assigneeIds: [ID!]
    $labelIds: [ID!]
    $projectV2Ids: [ID!]
  ) {
    createIssue(
      input: {
        repositoryId: $repositoryId
        title: $title
        body: $body
        assigneeIds: $assigneeIds
        labelIds: $labelIds
        projectV2Ids: $projectV2Ids
      }
    ) {
      issue {
        id
        number
        url
      }
    }
  }
`;

const ADD_ITEM_MUTATION = /* GraphQL */ `
  mutation AddItem($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item {
        id
      }
    }
  }
`;

const UPDATE_ISSUE_MUTATION = /* GraphQL */ `
  mutation UpdateIssue($id: ID!, $title: String, $body: String, $assigneeIds: [ID!]) {
    updateIssue(input: { id: $id, title: $title, body: $body, assigneeIds: $assigneeIds }) {
      issue {
        id
        title
        body
        updatedAt
      }
    }
  }
`;

const CLOSE_ISSUE_MUTATION = /* GraphQL */ `
  mutation CloseIssue($id: ID!, $reason: IssueClosedStateReason) {
    closeIssue(input: { issueId: $id, stateReason: $reason }) {
      issue {
        id
        state
        stateReason
        closedAt
      }
    }
  }
`;

const REOPEN_ISSUE_MUTATION = /* GraphQL */ `
  mutation ReopenIssue($id: ID!) {
    reopenIssue(input: { issueId: $id }) {
      issue {
        id
        state
        stateReason
        closedAt
      }
    }
  }
`;

const ADD_COMMENT_MUTATION = /* GraphQL */ `
  mutation AddComment($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      commentEdge { node { id body createdAt author { login avatarUrl } ${REACTIONS} } }
    }
  }
`;

const ARCHIVE_ITEM_MUTATION = /* GraphQL */ `
  mutation ArchiveItem($projectId: ID!, $itemId: ID!) {
    archiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
      item {
        id
      }
    }
  }
`;

const UNARCHIVE_ITEM_MUTATION = /* GraphQL */ `
  mutation UnarchiveItem($projectId: ID!, $itemId: ID!) {
    unarchiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
      item {
        id
      }
    }
  }
`;

const MOVE_ITEM_MUTATION = /* GraphQL */ `
  mutation MoveItem($projectId: ID!, $itemId: ID!, $afterId: ID) {
    updateProjectV2ItemPosition(
      input: { projectId: $projectId, itemId: $itemId, afterId: $afterId }
    ) {
      items(first: 1) {
        nodes {
          id
        }
      }
    }
  }
`;

const ADD_REACTION_MUTATION = /* GraphQL */ `
  mutation AddReaction($subjectId: ID!, $content: ReactionContent!) {
    addReaction(input: { subjectId: $subjectId, content: $content }) {
      subject { ... on Issue { ${REACTIONS} } ... on GitHubIssueComment { ${REACTIONS} } }
    }
  }
`;

const REMOVE_REACTION_MUTATION = /* GraphQL */ `
  mutation RemoveReaction($subjectId: ID!, $content: ReactionContent!) {
    removeReaction(input: { subjectId: $subjectId, content: $content }) {
      subject { ... on Issue { ${REACTIONS} } ... on GitHubIssueComment { ${REACTIONS} } }
    }
  }
`;

const ADD_SUB_ISSUE_MUTATION = /* GraphQL */ `
  mutation AddSubIssue($issueId: ID!, $subIssueId: ID!) {
    addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId, replaceParent: true }) {
      issue {
        id
        subIssuesSummary {
          total
          completed
          percentCompleted
        }
      }
    }
  }
`;

const REMOVE_SUB_ISSUE_MUTATION = /* GraphQL */ `
  mutation RemoveSubIssue($issueId: ID!, $subIssueId: ID!) {
    removeSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) {
      issue {
        id
        subIssuesSummary {
          total
          completed
          percentCompleted
        }
      }
    }
  }
`;

/**
 * The issue's activity feed. Comments and events come back in one timeline so the panel
 * renders them in true chronological order without stitching two paginated lists together.
 */
const ACTIVITY_QUERY = /* GraphQL */ `
  query Activity($id: ID!) {
    node(id: $id) {
      ... on Issue {
        timelineItems(
          last: 100
          itemTypes: [
            ISSUE_COMMENT
            CLOSED_EVENT
            REOPENED_EVENT
            ASSIGNED_EVENT
            UNASSIGNED_EVENT
            LABELED_EVENT
            UNLABELED_EVENT
            RENAMED_TITLE_EVENT
            PROJECT_V2_ITEM_STATUS_CHANGED_EVENT
            CROSS_REFERENCED_EVENT
            SUB_ISSUE_ADDED_EVENT
            SUB_ISSUE_REMOVED_EVENT
            PARENT_ISSUE_ADDED_EVENT
            PARENT_ISSUE_REMOVED_EVENT
            MARKED_AS_DUPLICATE_EVENT
          ]
        ) {
          nodes {
            __typename
            ... on GitHubIssueComment { id createdAt body author { login avatarUrl } ${REACTIONS} }
            ... on ClosedEvent { id createdAt stateReason ${ACTOR} }
            ... on ReopenedEvent { id createdAt ${ACTOR} }
            ... on AssignedEvent { id createdAt ${ACTOR} assignee { ... on User { login } } }
            ... on UnassignedEvent { id createdAt ${ACTOR} assignee { ... on User { login } } }
            ... on LabeledEvent { id createdAt ${ACTOR} label { name } }
            ... on UnlabeledEvent { id createdAt ${ACTOR} label { name } }
            ... on RenamedTitleEvent { id createdAt ${ACTOR} previousTitle currentTitle }
            ... on ProjectV2ItemStatusChangedEvent { id createdAt ${ACTOR} previousStatus status }
            ... on CrossReferencedEvent { id createdAt ${ACTOR} url source { ... on Issue { number title } ... on PullRequest { number title } } }
            ... on SubIssueAddedEvent { id createdAt ${ACTOR} subIssue { number title } }
            ... on SubIssueRemovedEvent { id createdAt ${ACTOR} subIssue { number title } }
            ... on ParentIssueAddedEvent { id createdAt ${ACTOR} parent { number title } }
            ... on ParentIssueRemovedEvent { id createdAt ${ACTOR} parent { number title } }
            ... on MarkedAsDuplicateEvent { id createdAt ${ACTOR} canonical { ... on Issue { number title } } }
          }
        }
      }
    }
  }
`;

// ---------- Raw response shapes ----------

interface RawField {
  __typename: string;
  id: string;
  name: string;
  dataType: string;
  options?: FieldOption[];
  multiSelectOptions?: FieldOption[];
}

interface RawFieldRef {
  id: string;
  name: string;
  dataType: string;
}

type RawFieldValue =
  | {
      __typename: 'ProjectV2ItemFieldSingleSelectValue';
      optionId: string;
      name: string;
      field: RawFieldRef;
    }
  | {
      __typename: 'ProjectV2ItemFieldMultiSelectValue';
      options: { id: string; name: string }[];
      field: RawFieldRef;
    }
  | { __typename: 'ProjectV2ItemFieldDateValue'; date: string | null; field: RawFieldRef }
  | { __typename: 'ProjectV2ItemFieldTextValue'; text: string | null; field: RawFieldRef }
  | { __typename: 'ProjectV2ItemFieldNumberValue'; number: number | null; field: RawFieldRef }
  | {
      __typename: 'ProjectV2ItemFieldIterationValue';
      iterationId: string;
      title: string;
      startDate: string;
      duration: number;
      field: RawFieldRef;
    }
  | { __typename: string };

interface RawIssue {
  __typename: 'Issue';
  id: string;
  number: number;
  title: string;
  body: string;
  state: IssueState;
  stateReason: IssueStateReason | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  author: GitHubPerson | null;
  assignees: { nodes: GitHubPerson[] };
  labels: { nodes: { name: string; color: string }[] };
  comments: { totalCount: number };
  repository: { nameWithOwner: string };
  parent: RawIssueRef | null;
  subIssuesSummary: { total: number; completed: number; percentCompleted: number } | null;
  reactionGroups: RawReactionGroup[] | null;
}

interface RawIssueRef {
  id: string;
  number: number;
  title: string;
  state: IssueState;
  stateReason: IssueStateReason | null;
  url: string;
  assignees: { nodes: GitHubPerson[] };
}

interface RawReactionGroup {
  content: ReactionContent;
  viewerHasReacted: boolean;
  reactors: { totalCount: number };
}

export interface RawItem {
  id: string;
  updatedAt: string;
  isArchived: boolean;
  fieldValues: { nodes: RawFieldValue[] };
  content: RawIssue | { __typename: string } | null;
}

// ---------- Schema ----------

const SCHEMA_TTL_MS = 10 * 60_000;
let schemaCache: { at: number; value: ProjectSchema } | undefined;

export function normalizeSchema(raw: {
  projectV2: { id: string; title: string; url: string; fields: { nodes: RawField[] } };
  repository: {
    id: string;
    name: string;
    nameWithOwner: string;
    labels: { nodes: ProjectSchema['repository']['labels'] };
  } | null;
}): ProjectSchema {
  const e = env();
  if (!raw.repository)
    throw new HttpError(500, `Issues repository ${e.GITHUB_ORG}/${e.GITHUB_ISSUES_REPO} not found`);
  const fields: ProjectField[] = raw.projectV2.fields.nodes.map((f) => ({
    id: f.id,
    name: f.name,
    dataType: f.dataType,
    ...(f.options ? { options: f.options } : {}),
    ...(f.multiSelectOptions ? { options: f.multiSelectOptions } : {}),
  }));
  return {
    projectId: raw.projectV2.id,
    title: raw.projectV2.title,
    url: raw.projectV2.url,
    org: e.GITHUB_ORG,
    number: e.GITHUB_PROJECT_NUMBER,
    fields,
    repository: { ...raw.repository, labels: raw.repository.labels.nodes },
    keyPrefix: e.ISSUE_KEY_PREFIX,
  };
}

export async function getSchema(
  gh: GitHubClient,
  opts: { force?: boolean } = {},
): Promise<ProjectSchema> {
  if (!opts.force && schemaCache && Date.now() - schemaCache.at < SCHEMA_TTL_MS)
    return schemaCache.value;
  const e = env();
  const data = await gh.graphql<{ organization: Parameters<typeof normalizeSchema>[0] | null }>(
    SCHEMA_QUERY,
    {
      org: e.GITHUB_ORG,
      number: e.GITHUB_PROJECT_NUMBER,
      repo: e.GITHUB_ISSUES_REPO,
    },
  );
  if (!data.organization?.projectV2)
    throw new HttpError(404, `Project ${e.GITHUB_ORG}#${e.GITHUB_PROJECT_NUMBER} not found`);
  const value = normalizeSchema(data.organization);
  schemaCache = { at: Date.now(), value };
  return value;
}

export function fieldByName(schema: ProjectSchema, name: string): ProjectField {
  const f = schema.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!f) throw new HttpError(400, `Unknown field "${name}"`);
  return f;
}

// ---------- Items ----------

function normalizeReactions(groups: RawReactionGroup[] | null | undefined): Reaction[] {
  return (groups ?? [])
    .filter((g) => g.reactors.totalCount > 0)
    .map((g) => ({
      content: g.content,
      count: g.reactors.totalCount,
      viewerHasReacted: g.viewerHasReacted,
    }));
}

function normalizeIssueRef(
  raw: RawIssueRef | null | undefined,
  keyPrefix: string,
): GitHubIssueRef | null {
  if (!raw) return null;
  return {
    id: raw.id,
    number: raw.number,
    key: `${keyPrefix}-${raw.number}`,
    title: raw.title,
    state: raw.state,
    stateReason: raw.stateReason,
    url: raw.url,
    assignees: raw.assignees?.nodes ?? [],
  };
}

function normalizeSubIssues(raw: RawIssue['subIssuesSummary']): GitHubSubIssueProgress {
  return {
    total: raw?.total ?? 0,
    completed: raw?.completed ?? 0,
    percent: Math.round(raw?.percentCompleted ?? 0),
  };
}

export function normalizeItem(raw: RawItem, keyPrefix: string): GitHubBoardItem | null {
  const c = raw.content;
  if (!c || c.__typename !== 'Issue') return null; // drafts and PRs are out of scope for v1
  const issue = c as RawIssue;

  const fields: Record<string, FieldValue> = {};
  for (const fv of raw.fieldValues.nodes) {
    switch (fv.__typename) {
      case 'ProjectV2ItemFieldSingleSelectValue': {
        const v = fv as Extract<
          RawFieldValue,
          { __typename: 'ProjectV2ItemFieldSingleSelectValue' }
        >;
        fields[v.field.name] = { kind: 'singleSelect', optionId: v.optionId, name: v.name };
        break;
      }
      case 'ProjectV2ItemFieldMultiSelectValue': {
        const v = fv as Extract<
          RawFieldValue,
          { __typename: 'ProjectV2ItemFieldMultiSelectValue' }
        >;
        if (v.options?.length) fields[v.field.name] = { kind: 'multiSelect', options: v.options };
        break;
      }
      case 'ProjectV2ItemFieldDateValue': {
        const v = fv as Extract<RawFieldValue, { __typename: 'ProjectV2ItemFieldDateValue' }>;
        if (v.date) fields[v.field.name] = { kind: 'date', date: v.date };
        break;
      }
      case 'ProjectV2ItemFieldTextValue': {
        const v = fv as Extract<RawFieldValue, { __typename: 'ProjectV2ItemFieldTextValue' }>;
        // The built-in Title field also arrives as a text value; the issue title is canonical.
        if (v.text && v.field.dataType !== 'TITLE')
          fields[v.field.name] = { kind: 'text', text: v.text };
        break;
      }
      case 'ProjectV2ItemFieldNumberValue': {
        const v = fv as Extract<RawFieldValue, { __typename: 'ProjectV2ItemFieldNumberValue' }>;
        if (v.number != null) fields[v.field.name] = { kind: 'number', number: v.number };
        break;
      }
      case 'ProjectV2ItemFieldIterationValue': {
        const v = fv as Extract<RawFieldValue, { __typename: 'ProjectV2ItemFieldIterationValue' }>;
        fields[v.field.name] = {
          kind: 'iteration',
          iterationId: v.iterationId,
          title: v.title,
          startDate: v.startDate,
          duration: v.duration,
        };
        break;
      }
      default:
        break;
    }
  }

  return {
    itemId: raw.id,
    issueId: issue.id,
    number: issue.number,
    key: `${keyPrefix}-${issue.number}`,
    title: issue.title,
    body: issue.body ?? '',
    state: issue.state,
    stateReason: issue.stateReason,
    url: issue.url,
    repository: issue.repository.nameWithOwner,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt > raw.updatedAt ? issue.updatedAt : raw.updatedAt,
    closedAt: issue.closedAt,
    author: issue.author,
    assignees: issue.assignees.nodes,
    labels: issue.labels.nodes,
    commentCount: issue.comments.totalCount,
    isArchived: raw.isArchived ?? false,
    parent: normalizeIssueRef(issue.parent, keyPrefix),
    subIssues: normalizeSubIssues(issue.subIssuesSummary),
    reactions: normalizeReactions(issue.reactionGroups),
    fields,
  };
}

export async function getBoard(gh: GitHubClient): Promise<GitHubBoardData> {
  const e = env();
  const items: GitHubBoardItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < 50; page++) {
    const data: {
      organization: {
        projectV2: {
          items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawItem[] };
        } | null;
      } | null;
    } = await gh.graphql(ITEMS_QUERY, {
      org: e.GITHUB_ORG,
      number: e.GITHUB_PROJECT_NUMBER,
      after,
    });
    const conn = data.organization?.projectV2?.items;
    if (!conn) throw new HttpError(404, 'Project not found');
    for (const raw of conn.nodes) {
      const item = normalizeItem(raw, e.ISSUE_KEY_PREFIX);
      if (item) items.push(item);
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return { items, fetchedAt: new Date().toISOString() };
}

export interface BoardDelta {
  items: GitHubBoardItem[];
  /**
   * False when more had changed than the page budget covers — past a certain volume a
   * full re-read is both cheaper and simpler than paging through the difference.
   */
  complete: boolean;
}

/**
 * Items whose issue was touched at or after `since`. The caller merges them into whatever
 * it already has, or falls back to a full read when `complete` is false.
 */
export async function getBoardSince(gh: GitHubClient, since: string, maxPages = 4): Promise<BoardDelta> {
  const e = env();
  const schema = await getSchema(gh);
  const items: GitHubBoardItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: {
      organization: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: { projectItems: { nodes: (RawItem & { project: { id: string } })[] } }[];
          };
        } | null;
      } | null;
    } = await gh.graphql(DELTA_QUERY, { org: e.GITHUB_ORG, repo: e.GITHUB_ISSUES_REPO, since, after });
    const conn = data.organization?.repository?.issues;
    if (!conn) throw new HttpError(404, 'Issues repository not found');
    for (const issue of conn.nodes) {
      for (const raw of issue.projectItems.nodes) {
        if (raw.project?.id !== schema.projectId) continue;
        const item = normalizeItem(raw, e.ISSUE_KEY_PREFIX);
        if (item) items.push(item);
      }
    }
    if (!conn.pageInfo.hasNextPage) return { items, complete: true };
    after = conn.pageInfo.endCursor;
  }
  return { items, complete: false };
}

export async function getItem(gh: GitHubClient, itemId: string): Promise<GitHubBoardItem> {
  const data = await gh.graphql<{ node: RawItem | null }>(ITEM_QUERY, { id: itemId });
  const item = data.node ? normalizeItem(data.node, env().ISSUE_KEY_PREFIX) : null;
  if (!item) throw new HttpError(404, 'Item not found');
  return item;
}

// ---------- Writes ----------

export async function setItemField(
  gh: GitHubClient,
  args: { itemId: string; fieldId: string; value: FieldWriteValue },
): Promise<void> {
  const schema = await getSchema(gh);
  if (args.value === null) {
    await gh.graphql(CLEAR_FIELD_MUTATION, {
      projectId: schema.projectId,
      itemId: args.itemId,
      fieldId: args.fieldId,
    });
    return;
  }
  await gh.graphql(SET_FIELD_MUTATION, {
    projectId: schema.projectId,
    itemId: args.itemId,
    fieldId: args.fieldId,
    value: args.value,
  });
}

/**
 * Status options that imply the GitHub issue should be closed, and with which reason.
 * Any other status implies the issue should be open.
 */
const CLOSING_STATUSES: Record<string, IssueStateReason> = {
  done: 'COMPLETED',
  canceled: 'NOT_PLANNED',
  cancelled: 'NOT_PLANNED',
  "can't reproduce": 'NOT_PLANNED',
  duplicate: 'DUPLICATE',
};

function statusFieldOf(schema: ProjectSchema): ProjectField | undefined {
  return schema.fields.find((f) => f.name.toLowerCase() === 'status');
}

/**
 * Set a field, then keep the issue's open/closed state consistent with its Status.
 * Returns the refreshed item.
 */
export async function setItemFieldAndSync(
  gh: GitHubClient,
  args: { itemId: string; fieldId: string; value: FieldWriteValue },
): Promise<GitHubBoardItem> {
  await setItemField(gh, args);
  let item = await getItem(gh, args.itemId);
  const schema = await getSchema(gh);
  const statusField = statusFieldOf(schema);
  if (!statusField || args.fieldId !== statusField.id) return item;

  const status = item.fields[statusField.name];
  const name = status?.kind === 'singleSelect' ? status.name.toLowerCase() : '';
  const reason = CLOSING_STATUSES[name];
  if (reason && item.state === 'OPEN') {
    await setIssueState(gh, item.issueId, 'CLOSED', reason);
    item = await getItem(gh, args.itemId);
  } else if (!reason && name && item.state === 'CLOSED') {
    await setIssueState(gh, item.issueId, 'OPEN');
    item = await getItem(gh, args.itemId);
  }
  return item;
}

/**
 * After an explicit open/close, move Status to a matching option (Done / Canceled / Todo)
 * when the current one contradicts the new state.
 */
export async function syncStatusToState(gh: GitHubClient, itemId: string): Promise<GitHubBoardItem> {
  const schema = await getSchema(gh);
  const statusField = statusFieldOf(schema);
  let item = await getItem(gh, itemId);
  if (!statusField?.options) return item;
  const current = item.fields[statusField.name];
  const currentName = current?.kind === 'singleSelect' ? current.name.toLowerCase() : '';
  const isClosingStatus = Boolean(CLOSING_STATUSES[currentName]);
  const find = (n: string) => statusField.options!.find((o) => o.name.toLowerCase() === n);

  let target: FieldOption | undefined;
  if (item.state === 'CLOSED' && !isClosingStatus) {
    target =
      item.stateReason === 'COMPLETED'
        ? find('done')
        : (find('canceled') ?? find('cancelled') ?? find('done'));
  } else if (item.state === 'OPEN' && isClosingStatus) {
    target = find('todo') ?? find('backlog') ?? statusField.options[0];
  }
  if (target && target.id !== (current?.kind === 'singleSelect' ? current.optionId : undefined)) {
    await setItemField(gh, {
      itemId,
      fieldId: statusField.id,
      value: { singleSelectOptionId: target.id },
    });
    item = await getItem(gh, itemId);
  }
  return item;
}

/** Resolve a field-name keyed map of writes into (fieldId, value) pairs, validating option ids. */
export function resolveFieldWrites(schema: ProjectSchema, writes: Record<string, FieldWriteValue>) {
  return Object.entries(writes).map(([name, value]) => {
    const field = fieldByName(schema, name);
    if (value && 'singleSelectOptionId' in value) {
      if (!field.options?.some((o) => o.id === value.singleSelectOptionId)) {
        throw new HttpError(
          400,
          `Option ${value.singleSelectOptionId} is not valid for field "${field.name}"`,
        );
      }
    }
    return { field, value };
  });
}

export async function createIssue(gh: GitHubClient, req: GitHubCreateIssueRequest): Promise<GitHubBoardItem> {
  const schema = await getSchema(gh);
  const writes = resolveFieldWrites(schema, req.fields ?? {});

  let assigneeIds: string[] | undefined;
  if (req.assigneeLogins?.length) {
    const members = await getMembers(gh);
    assigneeIds = req.assigneeLogins.map((l) => {
      const m = members.find((x) => x.login.toLowerCase() === l.toLowerCase());
      if (!m) throw new HttpError(400, `Unknown org member "${l}"`);
      return m.id;
    });
  }
  const labelIds = req.labelNames?.map((n) => {
    const l = schema.repository.labels.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (!l) throw new HttpError(400, `Unknown label "${n}"`);
    return l.id;
  });

  const created = await gh.graphql<{
    createIssue: { issue: { id: string; number: number; url: string } };
  }>(CREATE_ISSUE_MUTATION, {
    repositoryId: schema.repository.id,
    title: req.title,
    body: req.body ?? '',
    assigneeIds,
    labelIds,
    projectV2Ids: [schema.projectId],
  });
  const issueId = created.createIssue.issue.id;

  // Find (or add) the project item for this issue.
  let itemId = await findProjectItemId(gh, issueId, schema.projectId);
  if (!itemId) {
    const added = await gh.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
      ADD_ITEM_MUTATION,
      {
        projectId: schema.projectId,
        contentId: issueId,
      },
    );
    itemId = added.addProjectV2ItemById.item.id;
  }

  for (const { field, value } of writes) {
    await setItemField(gh, { itemId, fieldId: field.id, value });
  }
  return getItem(gh, itemId);
}

export async function findProjectItemId(
  gh: GitHubClient,
  issueId: string,
  projectId: string,
): Promise<string | null> {
  const data = await gh.graphql<{
    node: { projectItems?: { nodes: { id: string; project: { id: string } }[] } } | null;
  }>(ISSUE_PROJECT_ITEMS_QUERY, { id: issueId });
  return data.node?.projectItems?.nodes.find((n) => n.project.id === projectId)?.id ?? null;
}

export async function updateIssue(
  gh: GitHubClient,
  issueId: string,
  patch: { title?: string; body?: string; assigneeLogins?: string[] },
): Promise<void> {
  let assigneeIds: string[] | undefined;
  if (patch.assigneeLogins) {
    const members = await getMembers(gh);
    assigneeIds = patch.assigneeLogins.map((l) => {
      const m = members.find((x) => x.login.toLowerCase() === l.toLowerCase());
      if (!m) throw new HttpError(400, `Unknown org member "${l}"`);
      return m.id;
    });
  }
  if (patch.title === undefined && patch.body === undefined && assigneeIds === undefined) return;
  await gh.graphql(UPDATE_ISSUE_MUTATION, {
    id: issueId,
    title: patch.title,
    body: patch.body,
    assigneeIds,
  });
}

export async function setIssueState(
  gh: GitHubClient,
  issueId: string,
  state: IssueState,
  reason?: IssueStateReason,
): Promise<void> {
  if (state === 'CLOSED') {
    const r = reason === 'NOT_PLANNED' || reason === 'DUPLICATE' ? reason : 'COMPLETED';
    await gh.graphql(CLOSE_ISSUE_MUTATION, { id: issueId, reason: r });
  } else {
    await gh.graphql(REOPEN_ISSUE_MUTATION, { id: issueId });
  }
}

// ---------- Comments ----------

type RawComment = Omit<GitHubIssueComment, 'reactions'> & { reactionGroups: RawReactionGroup[] | null };

const normalizeComment = (c: RawComment): GitHubIssueComment => ({
  id: c.id,
  body: c.body,
  createdAt: c.createdAt,
  author: c.author,
  reactions: normalizeReactions(c.reactionGroups),
});

export async function getComments(gh: GitHubClient, issueId: string): Promise<GitHubIssueComment[]> {
  const data = await gh.graphql<{ node: { comments?: { nodes: RawComment[] } } | null }>(
    COMMENTS_QUERY,
    { id: issueId },
  );
  if (!data.node) throw new HttpError(404, 'Issue not found');
  return (data.node.comments?.nodes ?? []).map(normalizeComment);
}

export async function addComment(
  gh: GitHubClient,
  issueId: string,
  body: string,
): Promise<GitHubIssueComment> {
  const data = await gh.graphql<{ addComment: { commentEdge: { node: RawComment } } }>(
    ADD_COMMENT_MUTATION,
    {
      subjectId: issueId,
      body,
    },
  );
  return normalizeComment(data.addComment.commentEdge.node);
}

// ---------- Archive, ordering, bulk ----------

export async function setItemArchived(
  gh: GitHubClient,
  itemId: string,
  archived: boolean,
): Promise<GitHubBoardItem> {
  const schema = await getSchema(gh);
  await gh.graphql(archived ? ARCHIVE_ITEM_MUTATION : UNARCHIVE_ITEM_MUTATION, {
    projectId: schema.projectId,
    itemId,
  });
  return getItem(gh, itemId);
}

/**
 * Move an item so it sits directly after `afterId` in the project's manual order
 * (`afterId: null` moves it to the top). This is the order GitHub's own board uses.
 */
export async function moveItem(
  gh: GitHubClient,
  itemId: string,
  afterId: string | null,
): Promise<void> {
  const schema = await getSchema(gh);
  await gh.graphql(MOVE_ITEM_MUTATION, { projectId: schema.projectId, itemId, afterId });
}

/** Run `fn` over `items` with bounded concurrency, preserving input order in the result. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
  });
  await Promise.all(workers);
  return out;
}

export const BULK_LIMIT = 100;

/**
 * Apply one field value to many items. Failures are reported per item rather than
 * failing the whole request: a partial bulk edit is still worth keeping.
 */
export async function setFieldOnItems(
  gh: GitHubClient,
  args: { itemIds: string[]; fieldId: string; value: FieldWriteValue },
): Promise<GitHubBulkResult> {
  type Outcome = { ok: true; item: GitHubBoardItem } | { ok: false; itemId: string; error: string };
  const results = await mapLimit<string, Outcome>(args.itemIds, 4, async (itemId) => {
    try {
      return {
        ok: true,
        item: await setItemFieldAndSync(gh, { itemId, fieldId: args.fieldId, value: args.value }),
      };
    } catch (err) {
      return { ok: false, itemId, error: err instanceof Error ? err.message : 'Update failed' };
    }
  });
  return {
    items: results.flatMap((r) => (r.ok ? [r.item] : [])),
    failed: results.flatMap((r) => (r.ok ? [] : [{ itemId: r.itemId, error: r.error }])),
  };
}

// ---------- Reactions ----------

export async function setReaction(
  gh: GitHubClient,
  args: { subjectId: string; content: ReactionContent; on: boolean },
): Promise<Reaction[]> {
  const data = await gh.graphql<{
    addReaction?: { subject: { reactionGroups: RawReactionGroup[] | null } };
    removeReaction?: { subject: { reactionGroups: RawReactionGroup[] | null } };
  }>(args.on ? ADD_REACTION_MUTATION : REMOVE_REACTION_MUTATION, {
    subjectId: args.subjectId,
    content: args.content,
  });
  const subject = (data.addReaction ?? data.removeReaction)?.subject;
  return normalizeReactions(subject?.reactionGroups);
}

// ---------- Sub-issues ----------

/**
 * Attach or detach a sub-issue. `replaceParent` lets a re-parent succeed in one call
 * instead of failing because the child already belongs to another issue.
 */
export async function setSubIssue(
  gh: GitHubClient,
  args: { issueId: string; subIssueId: string; attach: boolean },
): Promise<void> {
  await gh.graphql(args.attach ? ADD_SUB_ISSUE_MUTATION : REMOVE_SUB_ISSUE_MUTATION, {
    issueId: args.issueId,
    subIssueId: args.subIssueId,
  });
}

// ---------- Activity ----------

interface RawTimelineNode {
  __typename: string;
  id: string;
  createdAt: string;
  actor?: GitHubPerson | null;
  author?: GitHubPerson | null;
  body?: string;
  reactionGroups?: RawReactionGroup[] | null;
  stateReason?: IssueStateReason | null;
  assignee?: { login?: string } | null;
  label?: { name: string } | null;
  previousTitle?: string;
  currentTitle?: string;
  previousStatus?: string;
  status?: string;
  url?: string;
  source?: { number?: number; title?: string } | null;
  subIssue?: { number: number; title: string } | null;
  parent?: { number: number; title: string } | null;
  canonical?: { number?: number; title?: string } | null;
}

function normalizeActivity(node: RawTimelineNode, keyPrefix: string): GitHubActivityEvent | null {
  const base = { id: node.id, createdAt: node.createdAt, actor: node.actor ?? null };
  const key = (n: number | undefined) => (n == null ? undefined : `${keyPrefix}-${n}`);
  const kinds: Record<string, () => GitHubActivityEvent | null> = {
    GitHubIssueComment: () => ({
      ...base,
      kind: 'comment',
      actor: node.author ?? null,
      body: node.body ?? '',
      reactions: normalizeReactions(node.reactionGroups),
    }),
    ClosedEvent: () => ({
      ...base,
      kind: 'closed',
      detail: node.stateReason === 'NOT_PLANNED' ? 'not planned' : 'completed',
    }),
    ReopenedEvent: () => ({ ...base, kind: 'reopened' }),
    AssignedEvent: () => ({ ...base, kind: 'assigned', detail: node.assignee?.login }),
    UnassignedEvent: () => ({ ...base, kind: 'unassigned', detail: node.assignee?.login }),
    LabeledEvent: () => ({ ...base, kind: 'labeled', detail: node.label?.name }),
    UnlabeledEvent: () => ({ ...base, kind: 'unlabeled', detail: node.label?.name }),
    RenamedTitleEvent: () => ({
      ...base,
      kind: 'renamed',
      from: node.previousTitle,
      to: node.currentTitle,
    }),
    ProjectV2ItemStatusChangedEvent: () => ({
      ...base,
      kind: 'status',
      from: node.previousStatus,
      to: node.status,
    }),
    CrossReferencedEvent: () => ({
      ...base,
      kind: 'referenced',
      detail: key(node.source?.number) ?? node.source?.title,
      url: node.url,
    }),
    SubIssueAddedEvent: () => ({
      ...base,
      kind: 'sub-issue-added',
      detail: key(node.subIssue?.number),
    }),
    SubIssueRemovedEvent: () => ({
      ...base,
      kind: 'sub-issue-removed',
      detail: key(node.subIssue?.number),
    }),
    ParentIssueAddedEvent: () => ({
      ...base,
      kind: 'parent-added',
      detail: key(node.parent?.number),
    }),
    ParentIssueRemovedEvent: () => ({
      ...base,
      kind: 'parent-removed',
      detail: key(node.parent?.number),
    }),
    MarkedAsDuplicateEvent: () => ({
      ...base,
      kind: 'duplicate',
      detail: key(node.canonical?.number),
    }),
  };
  return kinds[node.__typename]?.() ?? null;
}

export async function getActivity(gh: GitHubClient, issueId: string): Promise<GitHubActivityEvent[]> {
  const data = await gh.graphql<{ node: { timelineItems?: { nodes: RawTimelineNode[] } } | null }>(
    ACTIVITY_QUERY,
    {
      id: issueId,
    },
  );
  if (!data.node) throw new HttpError(404, 'Issue not found');
  const prefix = env().ISSUE_KEY_PREFIX;
  return (data.node.timelineItems?.nodes ?? [])
    .map((n) => normalizeActivity(n, prefix))
    .filter((e): e is GitHubActivityEvent => e !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ---------- Members ----------

let membersCache: { at: number; value: GitHubOrgMember[] } | undefined;

export async function getMembers(gh: GitHubClient): Promise<GitHubOrgMember[]> {
  if (membersCache && Date.now() - membersCache.at < SCHEMA_TTL_MS) return membersCache.value;
  const e = env();
  const out: GitHubOrgMember[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data: {
      organization: {
        membersWithRole: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: GitHubOrgMember[];
        };
      } | null;
    } = await gh.graphql(MEMBERS_QUERY, { org: e.GITHUB_ORG, after });
    const conn = data.organization?.membersWithRole;
    if (!conn) break;
    out.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  out.sort((a, b) => a.login.localeCompare(b.login));
  membersCache = { at: Date.now(), value: out };
  return out;
}
