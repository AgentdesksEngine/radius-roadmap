// Types shared between the Vercel functions (api/) and the SPA (src/).
// Keep this file free of runtime imports.

export type FieldDataType =
  | 'SINGLE_SELECT'
  | 'DATE'
  | 'TEXT'
  | 'NUMBER'
  | 'ITERATION'
  | 'TITLE'
  | 'ASSIGNEES'
  | 'LABELS'
  | 'LINKED_PULL_REQUESTS'
  | 'MILESTONE'
  | 'REPOSITORY'
  | 'REVIEWERS'
  | 'PARENT_ISSUE'
  | 'SUB_ISSUES_PROGRESS'
  | 'TRACKS'
  | 'TRACKED_BY'
  | 'CREATED'
  | 'UPDATED'
  | 'CLOSED'
  | (string & {});

export type OptionColor =
  'GRAY' | 'BLUE' | 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'PINK' | 'PURPLE';

export interface FieldOption {
  id: string;
  name: string;
  color: OptionColor;
  description: string;
}

export interface ProjectField {
  id: string;
  name: string;
  dataType: FieldDataType;
  /** Present for SINGLE_SELECT and MULTI_SELECT fields. Order is the board column order. */
  options?: FieldOption[];
}

export interface RepoLabel {
  id: string;
  name: string;
  color: string;
}

export interface ProjectSchema {
  projectId: string;
  title: string;
  url: string;
  org: string;
  number: number;
  fields: ProjectField[];
  repository: { id: string; name: string; nameWithOwner: string; labels: RepoLabel[] };
  keyPrefix: string;
}

export interface Person {
  login: string;
  avatarUrl: string;
  name?: string | null;
}

export type FieldValue =
  | { kind: 'singleSelect'; optionId: string; name: string }
  | { kind: 'date'; date: string }
  | { kind: 'text'; text: string }
  | { kind: 'number'; number: number }
  | { kind: 'multiSelect'; options: { id: string; name: string }[] }
  | { kind: 'iteration'; iterationId: string; title: string; startDate: string; duration: number };

export type IssueState = 'OPEN' | 'CLOSED';
export type IssueStateReason = 'COMPLETED' | 'NOT_PLANNED' | 'REOPENED' | 'DUPLICATE';

export type ReactionContent =
  'THUMBS_UP' | 'THUMBS_DOWN' | 'LAUGH' | 'HOORAY' | 'CONFUSED' | 'HEART' | 'ROCKET' | 'EYES';

export interface Reaction {
  content: ReactionContent;
  count: number;
  viewerHasReacted: boolean;
}

/** A lightweight pointer to another issue (parent, sub-issue, duplicate target). */
export interface IssueRef {
  id: string;
  number: number;
  key: string;
  title: string;
  state: IssueState;
  stateReason: IssueStateReason | null;
  url: string;
  assignees: Person[];
}

export interface SubIssueProgress {
  total: number;
  completed: number;
  percent: number;
}

export interface BoardItem {
  /** Project item node id (PVTI_...). Used for field mutations. */
  itemId: string;
  /** Issue node id (I_...). Used for issue mutations. */
  issueId: string;
  number: number;
  /** Linear-style key, e.g. RAD-42. */
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
  author: Person | null;
  assignees: Person[];
  labels: { name: string; color: string }[];
  commentCount: number;
  /** Archived project items stay in the project but are hidden from every view by default. */
  isArchived: boolean;
  parent: IssueRef | null;
  subIssues: SubIssueProgress;
  reactions: Reaction[];
  /** Custom field values keyed by field *name*. Unset fields are absent. */
  fields: Record<string, FieldValue>;
}

export interface BoardData {
  items: BoardItem[];
  fetchedAt: string;
  /** How the server produced this copy: served from memory, delta-synced, or fully re-read. */
  source?: 'cache' | 'delta' | 'full';
}

export interface SessionUser {
  login: string;
  avatarUrl: string;
  name: string | null;
}

export interface OrgMember extends Person {
  id: string;
}

export interface AuthStatus {
  user: SessionUser | null;
  oauthConfigured: boolean;
  devLoginAvailable: boolean;
}

export interface UpdateIssueRequest {
  title?: string;
  body?: string;
  state?: IssueState;
  stateReason?: IssueStateReason;
  assigneeLogins?: string[];
}

export interface IssueComment {
  id: string;
  body: string;
  createdAt: string;
  author: Person | null;
  reactions: Reaction[];
}

/**
 * One entry in an issue's activity feed: a comment or a GitHub timeline event.
 * Kinds we cannot render usefully are dropped server-side rather than shown as "other".
 */
export type ActivityKind =
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

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  createdAt: string;
  actor: Person | null;
  /** Comment body, for kind 'comment'. */
  body?: string;
  reactions?: Reaction[];
  /** What changed: a label, an assignee login, an issue key, a status name. */
  detail?: string;
  from?: string;
  to?: string;
  url?: string;
}

/** Value accepted by POST /api/items/:itemId/field */
export type FieldWriteValue =
  | { singleSelectOptionId: string }
  | { date: string }
  | { text: string }
  | { number: number }
  | { multiSelectOptionIds: string[] }
  | null;

export interface CreateIssueRequest {
  title: string;
  body?: string;
  /** field name -> write value, applied after the item is added to the project */
  fields?: Record<string, FieldWriteValue>;
  assigneeLogins?: string[];
  labelNames?: string[];
}

/** Apply one field value to many items in a single request. */
export interface BulkFieldRequest {
  itemIds: string[];
  fieldId: string;
  value: FieldWriteValue;
}

export interface BulkResult {
  /** Refreshed items, for the client to fold back into its board cache. */
  items: BoardItem[];
  failed: { itemId: string; error: string }[];
}

export interface ApiError {
  error: string;
  details?: unknown;
}
