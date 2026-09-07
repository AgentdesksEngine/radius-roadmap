/**
 * The one place that knows how the GitHub Project is shaped.
 * API routes, scripts and any future webhook handler all go through here.
 */
import type {
  BoardData,
  BoardItem,
  CreateIssueRequest,
  FieldOption,
  FieldValue,
  FieldWriteValue,
  IssueComment,
  IssueState,
  IssueStateReason,
  OrgMember,
  Person,
  ProjectField,
  ProjectSchema,
} from '../../../shared/types';
import { env } from '../env';
import { HttpError } from '../http';
import type { GitHubClient } from './gql';

// ---------- GraphQL documents ----------

const FIELD_COMMON = `... on ProjectV2FieldCommon { id name dataType }`;

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
          pageInfo { hasNextPage endCursor }
          nodes { ...ItemFields }
        }
      }
    }
  }
`;

const ITEM_QUERY = /* GraphQL */ `
  ${ITEM_FRAGMENT}
  query Item($id: ID!) {
    node(id: $id) { ...ItemFields }
  }
`;

const ISSUE_PROJECT_ITEMS_QUERY = /* GraphQL */ `
  query IssueItems($id: ID!) {
    node(id: $id) {
      ... on Issue { projectItems(first: 20) { nodes { id project { id } } } }
    }
  }
`;

const COMMENTS_QUERY = /* GraphQL */ `
  query Comments($id: ID!) {
    node(id: $id) {
      ... on Issue {
        comments(first: 100) {
          nodes { id body createdAt author { login avatarUrl } }
        }
      }
    }
  }
`;

const MEMBERS_QUERY = /* GraphQL */ `
  query Members($org: String!, $after: String) {
    organization(login: $org) {
      membersWithRole(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id login avatarUrl name }
      }
    }
  }
`;

const SET_FIELD_MUTATION = /* GraphQL */ `
  mutation SetField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
    updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
      projectV2Item { id }
    }
  }
`;

const CLEAR_FIELD_MUTATION = /* GraphQL */ `
  mutation ClearField($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
    clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) {
      projectV2Item { id }
    }
  }
`;

const CREATE_ISSUE_MUTATION = /* GraphQL */ `
  mutation CreateIssue($repositoryId: ID!, $title: String!, $body: String, $assigneeIds: [ID!], $labelIds: [ID!], $projectV2Ids: [ID!]) {
    createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body, assigneeIds: $assigneeIds, labelIds: $labelIds, projectV2Ids: $projectV2Ids }) {
      issue { id number url }
    }
  }
`;

const ADD_ITEM_MUTATION = /* GraphQL */ `
  mutation AddItem($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
  }
`;

const UPDATE_ISSUE_MUTATION = /* GraphQL */ `
  mutation UpdateIssue($id: ID!, $title: String, $body: String, $assigneeIds: [ID!]) {
    updateIssue(input: { id: $id, title: $title, body: $body, assigneeIds: $assigneeIds }) {
      issue { id title body updatedAt }
    }
  }
`;

const CLOSE_ISSUE_MUTATION = /* GraphQL */ `
  mutation CloseIssue($id: ID!, $reason: IssueClosedStateReason) {
    closeIssue(input: { issueId: $id, stateReason: $reason }) { issue { id state stateReason closedAt } }
  }
`;

const REOPEN_ISSUE_MUTATION = /* GraphQL */ `
  mutation ReopenIssue($id: ID!) {
    reopenIssue(input: { issueId: $id }) { issue { id state stateReason closedAt } }
  }
`;

const ADD_COMMENT_MUTATION = /* GraphQL */ `
  mutation AddComment($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      commentEdge { node { id body createdAt author { login avatarUrl } } }
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
  | { __typename: 'ProjectV2ItemFieldSingleSelectValue'; optionId: string; name: string; field: RawFieldRef }
  | { __typename: 'ProjectV2ItemFieldMultiSelectValue'; options: { id: string; name: string }[]; field: RawFieldRef }
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
  author: Person | null;
  assignees: { nodes: Person[] };
  labels: { nodes: { name: string; color: string }[] };
  comments: { totalCount: number };
  repository: { nameWithOwner: string };
}

export interface RawItem {
  id: string;
  updatedAt: string;
  fieldValues: { nodes: RawFieldValue[] };
  content: RawIssue | { __typename: string } | null;
}

// ---------- Schema ----------

const SCHEMA_TTL_MS = 10 * 60_000;
let schemaCache: { at: number; value: ProjectSchema } | undefined;

export function normalizeSchema(raw: {
  projectV2: { id: string; title: string; url: string; fields: { nodes: RawField[] } };
  repository: { id: string; name: string; nameWithOwner: string; labels: { nodes: ProjectSchema['repository']['labels'] } } | null;
}): ProjectSchema {
  const e = env();
  if (!raw.repository) throw new HttpError(500, `Issues repository ${e.GITHUB_ORG}/${e.GITHUB_ISSUES_REPO} not found`);
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

export async function getSchema(gh: GitHubClient, opts: { force?: boolean } = {}): Promise<ProjectSchema> {
  if (!opts.force && schemaCache && Date.now() - schemaCache.at < SCHEMA_TTL_MS) return schemaCache.value;
  const e = env();
  const data = await gh.graphql<{ organization: Parameters<typeof normalizeSchema>[0] | null }>(SCHEMA_QUERY, {
    org: e.GITHUB_ORG,
    number: e.GITHUB_PROJECT_NUMBER,
    repo: e.GITHUB_ISSUES_REPO,
  });
  if (!data.organization?.projectV2) throw new HttpError(404, `Project ${e.GITHUB_ORG}#${e.GITHUB_PROJECT_NUMBER} not found`);
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

export function normalizeItem(raw: RawItem, keyPrefix: string): BoardItem | null {
  const c = raw.content;
  if (!c || c.__typename !== 'Issue') return null; // drafts and PRs are out of scope for v1
  const issue = c as RawIssue;

  const fields: Record<string, FieldValue> = {};
  for (const fv of raw.fieldValues.nodes) {
    switch (fv.__typename) {
      case 'ProjectV2ItemFieldSingleSelectValue': {
        const v = fv as Extract<RawFieldValue, { __typename: 'ProjectV2ItemFieldSingleSelectValue' }>;
        fields[v.field.name] = { kind: 'singleSelect', optionId: v.optionId, name: v.name };
        break;
      }
      case 'ProjectV2ItemFieldMultiSelectValue': {
        const v = fv as Extract<RawFieldValue, { __typename: 'ProjectV2ItemFieldMultiSelectValue' }>;
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
        if (v.text && v.field.dataType !== 'TITLE') fields[v.field.name] = { kind: 'text', text: v.text };
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
    fields,
  };
}

export async function getBoard(gh: GitHubClient): Promise<BoardData> {
  const e = env();
  const items: BoardItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < 50; page++) {
    const data: {
      organization: {
        projectV2: { items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawItem[] } } | null;
      } | null;
    } = await gh.graphql(ITEMS_QUERY, { org: e.GITHUB_ORG, number: e.GITHUB_PROJECT_NUMBER, after });
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

export async function getItem(gh: GitHubClient, itemId: string): Promise<BoardItem> {
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
    await gh.graphql(CLEAR_FIELD_MUTATION, { projectId: schema.projectId, itemId: args.itemId, fieldId: args.fieldId });
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
): Promise<BoardItem> {
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
export async function syncStatusToState(gh: GitHubClient, itemId: string): Promise<BoardItem> {
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
    target = item.stateReason === 'COMPLETED' ? find('done') : (find('canceled') ?? find('cancelled') ?? find('done'));
  } else if (item.state === 'OPEN' && isClosingStatus) {
    target = find('todo') ?? find('backlog') ?? statusField.options[0];
  }
  if (target && target.id !== (current?.kind === 'singleSelect' ? current.optionId : undefined)) {
    await setItemField(gh, { itemId, fieldId: statusField.id, value: { singleSelectOptionId: target.id } });
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
        throw new HttpError(400, `Option ${value.singleSelectOptionId} is not valid for field "${field.name}"`);
      }
    }
    return { field, value };
  });
}

export async function createIssue(gh: GitHubClient, req: CreateIssueRequest): Promise<BoardItem> {
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

  const created = await gh.graphql<{ createIssue: { issue: { id: string; number: number; url: string } } }>(
    CREATE_ISSUE_MUTATION,
    {
      repositoryId: schema.repository.id,
      title: req.title,
      body: req.body ?? '',
      assigneeIds,
      labelIds,
      projectV2Ids: [schema.projectId],
    },
  );
  const issueId = created.createIssue.issue.id;

  // Find (or add) the project item for this issue.
  let itemId = await findProjectItemId(gh, issueId, schema.projectId);
  if (!itemId) {
    const added = await gh.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(ADD_ITEM_MUTATION, {
      projectId: schema.projectId,
      contentId: issueId,
    });
    itemId = added.addProjectV2ItemById.item.id;
  }

  for (const { field, value } of writes) {
    await setItemField(gh, { itemId, fieldId: field.id, value });
  }
  return getItem(gh, itemId);
}

export async function findProjectItemId(gh: GitHubClient, issueId: string, projectId: string): Promise<string | null> {
  const data = await gh.graphql<{ node: { projectItems?: { nodes: { id: string; project: { id: string } }[] } } | null }>(
    ISSUE_PROJECT_ITEMS_QUERY,
    { id: issueId },
  );
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
  await gh.graphql(UPDATE_ISSUE_MUTATION, { id: issueId, title: patch.title, body: patch.body, assigneeIds });
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

export async function getComments(gh: GitHubClient, issueId: string): Promise<IssueComment[]> {
  const data = await gh.graphql<{ node: { comments?: { nodes: IssueComment[] } } | null }>(COMMENTS_QUERY, { id: issueId });
  if (!data.node) throw new HttpError(404, 'Issue not found');
  return data.node.comments?.nodes ?? [];
}

export async function addComment(gh: GitHubClient, issueId: string, body: string): Promise<IssueComment> {
  const data = await gh.graphql<{ addComment: { commentEdge: { node: IssueComment } } }>(ADD_COMMENT_MUTATION, {
    subjectId: issueId,
    body,
  });
  return data.addComment.commentEdge.node;
}

// ---------- Members ----------

let membersCache: { at: number; value: OrgMember[] } | undefined;

export async function getMembers(gh: GitHubClient): Promise<OrgMember[]> {
  if (membersCache && Date.now() - membersCache.at < SCHEMA_TTL_MS) return membersCache.value;
  const e = env();
  const out: OrgMember[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data: {
      organization: { membersWithRole: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrgMember[] } } | null;
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
