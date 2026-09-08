/**
 * The one place that knows how the Postgres schema (supabase/migrations/0001_init.sql) maps
 * onto the app's `BoardItem`/`ProjectSchema` contract in shared/types.ts. Port of the former
 * api/_lib/github/board.ts, same exported names where practical.
 *
 * NOT YET VERIFIED AGAINST A LIVE DATABASE (see Phase 0 in the plan). Two postgres.js idioms
 * used below should be double-checked against the installed `postgres` version's docs during
 * that first real test pass:
 *   - `sql(someArray)` used as an IN-list (e.g. `not in ${tx(validIds)}`)
 *   - `sql.array(...)` is deliberately NOT used; array membership below goes through IN-lists
 *     built from `sql(ids)` for the same reason.
 * Everything else is plain parameterized SQL.
 */
import type {
  ActivityEvent,
  BoardData,
  BoardItem,
  BulkResult,
  CreateIssueRequest,
  FieldDataType,
  FieldOption,
  FieldValue,
  FieldWriteValue,
  IssueComment,
  IssueRef,
  IssueState,
  IssueStateReason,
  OptionColor,
  OrgMember,
  Person,
  ProjectField,
  ProjectSchema,
  Reaction,
  ReactionContent,
} from '../../../shared/types.js';
import { env } from '../env.js';
import { HttpError } from '../http.js';
import { db, withActor } from './pool.js';

// ---------- Schema ----------

const SCHEMA_TTL_MS = 10 * 60_000;
let schemaCache: { at: number; value: ProjectSchema } | undefined;

export async function getSchema(opts: { force?: boolean } = {}): Promise<ProjectSchema> {
  if (!opts.force && schemaCache && Date.now() - schemaCache.at < SCHEMA_TTL_MS) {
    return schemaCache.value;
  }
  const sql = db();
  const fieldDefs = await sql<{ id: string; name: string; data_type: string; sort_order: number }[]>`
    select id, name, data_type, sort_order from field_defs order by sort_order
  `;
  const fieldOptions = await sql<
    { id: string; field_def_id: string; name: string; color: string; description: string; sort_order: number }[]
  >`
    select id, field_def_id, name, color, description, sort_order
    from field_options
    order by sort_order
  `;
  const labelRows = await sql<{ id: string; name: string; color: string }[]>`
    select id, name, color from labels order by name
  `;

  const optionsByField = new Map<string, FieldOption[]>();
  for (const o of fieldOptions) {
    const list = optionsByField.get(o.field_def_id) ?? [];
    list.push({ id: o.id, name: o.name, color: o.color as OptionColor, description: o.description });
    optionsByField.set(o.field_def_id, list);
  }

  const fields: ProjectField[] = fieldDefs.map((f) => ({
    id: f.id,
    name: f.name,
    dataType: f.data_type as FieldDataType,
    ...(optionsByField.has(f.id) ? { options: optionsByField.get(f.id) } : {}),
  }));

  const e = env();
  const value: ProjectSchema = {
    projectId: 'radius-bugtracker',
    title: 'Radius Roadmap',
    url: e.appUrl,
    org: 'radiusagent',
    number: 1,
    fields,
    repository: {
      id: 'radius-roadmap',
      name: 'radius-roadmap',
      nameWithOwner: 'radiusagent/radius-roadmap',
      labels: labelRows,
    },
    keyPrefix: e.ISSUE_KEY_PREFIX,
  };
  schemaCache = { at: Date.now(), value };
  return value;
}

export function fieldByName(schema: ProjectSchema, name: string): ProjectField {
  const f = schema.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!f) throw new HttpError(400, `Unknown field "${name}"`);
  return f;
}

function optionIndex(schema: ProjectSchema): Map<string, FieldOption> {
  const m = new Map<string, FieldOption>();
  for (const f of schema.fields) for (const o of f.options ?? []) m.set(o.id, o);
  return m;
}

/** Resolve a field-name keyed map of writes into (field, value) pairs, validating option ids. */
export function resolveFieldWrites(schema: ProjectSchema, writes: Record<string, FieldWriteValue>) {
  return Object.entries(writes).map(([name, value]) => {
    const field = fieldByName(schema, name);
    if (value && 'singleSelectOptionId' in value) {
      if (!field.options?.some((o) => o.id === value.singleSelectOptionId)) {
        throw new HttpError(400, `Option ${value.singleSelectOptionId} is not valid for field "${field.name}"`);
      }
    }
    if (value && 'multiSelectOptionIds' in value) {
      for (const id of value.multiSelectOptionIds) {
        if (!field.options?.some((o) => o.id === id)) {
          throw new HttpError(400, `Option ${id} is not valid for field "${field.name}"`);
        }
      }
    }
    return { field, value };
  });
}

function fieldValueToJsonb(value: FieldWriteValue): Record<string, unknown> | null {
  if (value === null) return null;
  if ('singleSelectOptionId' in value) return { optionId: value.singleSelectOptionId };
  if ('multiSelectOptionIds' in value) return { optionIds: value.multiSelectOptionIds };
  if ('date' in value) return { date: value.date };
  if ('text' in value) return { text: value.text };
  if ('number' in value) return { number: value.number };
  return null;
}

function resolveFields(
  raw: Record<string, any> | null | undefined,
  schema: ProjectSchema,
  optionById: Map<string, FieldOption>,
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  if (!raw) return out;
  for (const field of schema.fields) {
    const v = raw[field.id];
    if (v == null) continue;
    switch (field.dataType) {
      case 'SINGLE_SELECT': {
        const opt = v.optionId ? optionById.get(v.optionId) : undefined;
        if (opt) out[field.name] = { kind: 'singleSelect', optionId: opt.id, name: opt.name };
        break;
      }
      case 'MULTI_SELECT': {
        const ids: string[] = v.optionIds ?? [];
        const opts = ids.map((id) => optionById.get(id)).filter((o): o is FieldOption => Boolean(o));
        if (opts.length) out[field.name] = { kind: 'multiSelect', options: opts.map((o) => ({ id: o.id, name: o.name })) };
        break;
      }
      case 'DATE':
        if (v.date) out[field.name] = { kind: 'date', date: v.date };
        break;
      case 'TEXT':
        if (v.text) out[field.name] = { kind: 'text', text: v.text };
        break;
      case 'NUMBER':
        if (v.number != null) out[field.name] = { kind: 'number', number: v.number };
        break;
      default:
        break;
    }
  }
  return out;
}

// ---------- Items ----------

function personFromRow(p: { id: string; name: string | null; avatarUrl: string | null } | null): Person | null {
  return p ? { id: p.id, name: p.name, avatarUrl: p.avatarUrl } : null;
}

function issueUrl(keyPrefix: string, number: number): string {
  return `${env().appUrl}/issue/${keyPrefix}-${number}`;
}

interface RawIssueRow {
  id: string;
  number: number;
  title: string;
  body: string;
  state: IssueState;
  stateReason: IssueStateReason | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  isArchived: boolean;
  parentIssueId: string | null;
  fields: Record<string, any>;
  subIssuesTotal: number;
  subIssuesCompleted: number;
  position: number;
  authorId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  commentCount: number;
  labels: { name: string; color: string }[];
  assignees: { id: string; name: string | null; avatarUrl: string | null }[];
  reactions: { content: string; count: number; viewerHasReacted: boolean }[];
  parentNumber: number | null;
  parentTitle: string | null;
  parentState: IssueState | null;
  parentStateReason: IssueStateReason | null;
  parentAssignees: { id: string; name: string | null; avatarUrl: string | null }[] | null;
}

/**
 * Fetches one page of fully-hydrated issue rows. `filter: 'all'` returns the whole board
 * (accepted for v1 — see the plan's "fetch full board" call); `{id}` filters to one issue,
 * but the CTE still computes every row's summary first so the self-join can find the
 * parent's precomputed assignees — fine at current scale, revisit at the row-count trigger
 * called out in the plan.
 */
async function queryIssues(viewerProfileId: string | null, filter: 'all' | { id: string }): Promise<RawIssueRow[]> {
  const sql = db();
  const vpid = viewerProfileId;
  return sql<RawIssueRow[]>`
    with summary as (
      select
        i.id, i.number, i.title, i.body, i.state, i.state_reason as "stateReason",
        i.created_at as "createdAt", i.updated_at as "updatedAt", i.closed_at as "closedAt",
        i.is_archived as "isArchived", i.parent_issue_id as "parentIssueId", i.fields,
        i.sub_issues_total as "subIssuesTotal", i.sub_issues_completed as "subIssuesCompleted",
        i.position,
        author.id as "authorId", author.display_name as "authorName", author.avatar_url as "authorAvatarUrl",
        (select count(*)::int from comments c where c.issue_id = i.id) as "commentCount",
        coalesce(lbl.agg, '[]'::json) as labels,
        coalesce(asg.agg, '[]'::json) as assignees,
        coalesce(rxn.agg, '[]'::json) as reactions
      from issues i
      left join profiles author on author.id = i.author_id
      left join lateral (
        select json_agg(json_build_object('name', l.name, 'color', l.color)) as agg
        from issue_labels il join labels l on l.id = il.label_id
        where il.issue_id = i.id
      ) lbl on true
      left join lateral (
        select json_agg(json_build_object('id', p.id, 'name', p.display_name, 'avatarUrl', p.avatar_url)) as agg
        from issue_assignees ia join profiles p on p.id = ia.profile_id
        where ia.issue_id = i.id
      ) asg on true
      left join lateral (
        select json_agg(json_build_object(
          'content', r.content, 'count', r.cnt, 'viewerHasReacted', r.viewer_reacted
        )) as agg
        from (
          select content, count(*) as cnt, bool_or(profile_id = ${vpid}) as viewer_reacted
          from reactions where subject_type = 'issue' and subject_id = i.id
          group by content
        ) r
      ) rxn on true
    )
    select s.*,
      parent.number as "parentNumber", parent.title as "parentTitle",
      parent.state as "parentState", parent."stateReason" as "parentStateReason",
      parent.assignees as "parentAssignees"
    from summary s
    left join summary parent on parent.id = s."parentIssueId"
    ${filter === 'all' ? sql`` : sql`where s.id = ${filter.id}`}
    order by s.position asc
  `;
}

function rowToBoardItem(
  row: RawIssueRow,
  schema: ProjectSchema,
  optionById: Map<string, FieldOption>,
): BoardItem {
  const keyPrefix = schema.keyPrefix;
  const parent: IssueRef | null =
    row.parentIssueId && row.parentNumber != null
      ? {
          id: row.parentIssueId,
          number: row.parentNumber,
          key: `${keyPrefix}-${row.parentNumber}`,
          title: row.parentTitle ?? '',
          state: row.parentState ?? 'OPEN',
          stateReason: row.parentStateReason,
          url: issueUrl(keyPrefix, row.parentNumber),
          assignees: (row.parentAssignees ?? []).flatMap((p) => {
            const person = personFromRow(p);
            return person ? [person] : [];
          }),
        }
      : null;

  return {
    itemId: row.id,
    issueId: row.id,
    number: row.number,
    key: `${keyPrefix}-${row.number}`,
    title: row.title,
    body: row.body ?? '',
    state: row.state,
    stateReason: row.stateReason,
    url: issueUrl(keyPrefix, row.number),
    repository: schema.repository.nameWithOwner,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
    author: row.authorId ? { id: row.authorId, name: row.authorName, avatarUrl: row.authorAvatarUrl } : null,
    assignees: row.assignees.flatMap((p) => {
      const person = personFromRow(p);
      return person ? [person] : [];
    }),
    labels: row.labels,
    commentCount: row.commentCount,
    isArchived: row.isArchived,
    parent,
    subIssues: {
      total: row.subIssuesTotal,
      completed: row.subIssuesCompleted,
      percent: row.subIssuesTotal ? Math.round((row.subIssuesCompleted / row.subIssuesTotal) * 100) : 0,
    },
    reactions: row.reactions.map((r) => ({
      content: r.content as ReactionContent,
      count: r.count,
      viewerHasReacted: r.viewerHasReacted,
    })),
    fields: resolveFields(row.fields, schema, optionById),
  };
}

export async function getBoard(viewerProfileId: string | null): Promise<BoardData> {
  const schema = await getSchema();
  const optById = optionIndex(schema);
  const rows = await queryIssues(viewerProfileId, 'all');
  return { items: rows.map((r) => rowToBoardItem(r, schema, optById)), fetchedAt: new Date().toISOString() };
}

export async function getItem(itemId: string, viewerProfileId: string | null): Promise<BoardItem> {
  const schema = await getSchema();
  const optById = optionIndex(schema);
  const rows = await queryIssues(viewerProfileId, { id: itemId });
  const row = rows[0];
  if (!row) throw new HttpError(404, 'Item not found');
  return rowToBoardItem(row, schema, optById);
}

// ---------- Writes: fields ----------

export async function setItemField(
  profileId: string,
  args: { itemId: string; fieldId: string; value: FieldWriteValue },
): Promise<void> {
  await withActor(profileId, async (tx) => {
    if (args.value === null) {
      await tx`update issues set fields = fields - ${args.fieldId} where id = ${args.itemId}`;
    } else {
      const json = JSON.stringify(fieldValueToJsonb(args.value));
      await tx`update issues set fields = jsonb_set(fields, array[${args.fieldId}], ${json}::jsonb) where id = ${args.itemId}`;
    }
  });
}

/**
 * Sets a field and returns the refreshed item. Unlike the old GitHub version, there is no
 * separate "sync status" round trip here — the `issues_sync_state_and_status` BEFORE UPDATE
 * trigger keeps `state`/`state_reason` consistent with the Status field atomically, in the
 * same UPDATE that `setItemField` above issues.
 */
export async function setItemFieldAndSync(
  profileId: string,
  args: { itemId: string; fieldId: string; value: FieldWriteValue },
): Promise<BoardItem> {
  await setItemField(profileId, args);
  return getItem(args.itemId, profileId);
}

export const BULK_LIMIT = 100;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
  });
  await Promise.all(workers);
  return out;
}

export async function setFieldOnItems(
  profileId: string,
  args: { itemIds: string[]; fieldId: string; value: FieldWriteValue },
): Promise<BulkResult> {
  type Outcome = { ok: true; item: BoardItem } | { ok: false; itemId: string; error: string };
  const results = await mapLimit<string, Outcome>(args.itemIds, 4, async (itemId) => {
    try {
      const item = await setItemFieldAndSync(profileId, { itemId, fieldId: args.fieldId, value: args.value });
      return { ok: true, item };
    } catch (err) {
      return { ok: false, itemId, error: err instanceof Error ? err.message : 'Update failed' };
    }
  });
  return {
    items: results.flatMap((r) => (r.ok ? [r.item] : [])),
    failed: results.flatMap((r) => (r.ok ? [] : [{ itemId: r.itemId, error: r.error }])),
  };
}

// ---------- Writes: issues ----------

export async function createIssue(profileId: string, req: CreateIssueRequest): Promise<BoardItem> {
  const schema = await getSchema();
  const writes = resolveFieldWrites(schema, req.fields ?? {});
  const fieldsJson: Record<string, unknown> = {};
  for (const { field, value } of writes) {
    const v = fieldValueToJsonb(value);
    if (v) fieldsJson[field.id] = v;
  }

  const labelIds = (req.labelNames ?? []).map((n) => {
    const l = schema.repository.labels.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (!l) throw new HttpError(400, `Unknown label "${n}"`);
    return l.id;
  });

  let assigneeIds: string[] = [];
  if (req.assigneeIds?.length) {
    const members = await getMembers();
    assigneeIds = req.assigneeIds.map((id) => {
      const m = members.find((x) => x.id === id);
      if (!m) throw new HttpError(400, `Unknown member "${id}"`);
      return m.id;
    });
  }

  const newIssueId = await withActor(profileId, async (tx) => {
    const [issue] = await tx<{ id: string }[]>`
      insert into issues (title, body, author_id, fields)
      values (${req.title}, ${req.body ?? ''}, ${profileId}, ${JSON.stringify(fieldsJson)}::jsonb)
      returning id
    `;
    for (const labelId of labelIds) {
      await tx`insert into issue_labels (issue_id, label_id) values (${issue!.id}, ${labelId})`;
    }
    for (const assigneeId of assigneeIds) {
      await tx`insert into issue_assignees (issue_id, profile_id) values (${issue!.id}, ${assigneeId})`;
    }
    return issue!.id;
  });

  return getItem(newIssueId, profileId);
}

export async function updateIssue(
  profileId: string,
  issueId: string,
  patch: { title?: string; body?: string; assigneeIds?: string[] },
): Promise<void> {
  await withActor(profileId, async (tx) => {
    if (patch.title !== undefined || patch.body !== undefined) {
      await tx`
        update issues set
          title = coalesce(${patch.title ?? null}, title),
          body = coalesce(${patch.body ?? null}, body)
        where id = ${issueId}
      `;
    }
    if (patch.assigneeIds !== undefined) {
      const members = await getMembers();
      const validIds = patch.assigneeIds.map((id) => {
        const m = members.find((x) => x.id === id);
        if (!m) throw new HttpError(400, `Unknown member "${id}"`);
        return m.id;
      });
      if (validIds.length) {
        await tx`delete from issue_assignees where issue_id = ${issueId} and profile_id not in ${tx(validIds)}`;
      } else {
        await tx`delete from issue_assignees where issue_id = ${issueId}`;
      }
      for (const id of validIds) {
        await tx`insert into issue_assignees (issue_id, profile_id) values (${issueId}, ${id}) on conflict do nothing`;
      }
    }
  });
}

export async function setIssueState(
  profileId: string,
  issueId: string,
  state: IssueState,
  reason?: IssueStateReason,
): Promise<void> {
  await withActor(profileId, async (tx) => {
    if (state === 'CLOSED') {
      const r = reason === 'NOT_PLANNED' || reason === 'DUPLICATE' ? reason : 'COMPLETED';
      await tx`update issues set state = 'CLOSED', state_reason = ${r}, closed_at = now() where id = ${issueId}`;
    } else {
      await tx`update issues set state = 'OPEN', state_reason = null, closed_at = null where id = ${issueId}`;
    }
  });
}

// ---------- Comments ----------

async function reactionsForSubjects(
  subjectType: 'issue' | 'comment',
  ids: string[],
  viewerProfileId: string | null,
): Promise<Map<string, Reaction[]>> {
  const map = new Map<string, Reaction[]>();
  if (ids.length === 0) return map;
  const sql = db();
  const rows = await sql<{ subjectId: string; content: string; cnt: number; viewer: boolean }[]>`
    select subject_id as "subjectId", content, count(*)::int as cnt,
      bool_or(profile_id = ${viewerProfileId}) as viewer
    from reactions
    where subject_type = ${subjectType} and subject_id in ${sql(ids)}
    group by subject_id, content
  `;
  for (const r of rows) {
    const list = map.get(r.subjectId) ?? [];
    list.push({ content: r.content as ReactionContent, count: r.cnt, viewerHasReacted: r.viewer });
    map.set(r.subjectId, list);
  }
  return map;
}

export async function getComments(issueId: string): Promise<IssueComment[]> {
  const sql = db();
  const rows = await sql<
    { id: string; body: string; createdAt: string; authorId: string | null; authorName: string | null; authorAvatarUrl: string | null }[]
  >`
    select c.id, c.body, c.created_at as "createdAt",
      author.id as "authorId", author.display_name as "authorName", author.avatar_url as "authorAvatarUrl"
    from comments c
    left join profiles author on author.id = c.author_id
    where c.issue_id = ${issueId}
    order by c.created_at asc
  `;
  const reactions = await reactionsForSubjects('comment', rows.map((r) => r.id), null);
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt,
    author: r.authorId ? { id: r.authorId, name: r.authorName, avatarUrl: r.authorAvatarUrl } : null,
    reactions: reactions.get(r.id) ?? [],
  }));
}

export async function addComment(profileId: string, issueId: string, body: string): Promise<IssueComment> {
  return withActor(profileId, async (tx) => {
    const [row] = await tx<{ id: string; body: string; createdAt: string }[]>`
      insert into comments (issue_id, author_id, body)
      values (${issueId}, ${profileId}, ${body})
      returning id, body, created_at as "createdAt"
    `;
    const [author] = await tx<{ id: string; name: string | null; avatarUrl: string | null }[]>`
      select id, display_name as name, avatar_url as "avatarUrl" from profiles where id = ${profileId}
    `;
    return {
      id: row!.id,
      body: row!.body,
      createdAt: row!.createdAt,
      author: author ?? null,
      reactions: [],
    };
  });
}

// ---------- Archive, ordering ----------

export async function setItemArchived(profileId: string, itemId: string, archived: boolean): Promise<BoardItem> {
  await withActor(profileId, (tx) => tx`update issues set is_archived = ${archived} where id = ${itemId}`);
  return getItem(itemId, profileId);
}

/** `afterId: null` moves the item to the top. See `move_item()` in the migration. */
export async function moveItem(profileId: string, itemId: string, afterId: string | null): Promise<void> {
  await withActor(profileId, (tx) => tx`select move_item(${itemId}, ${afterId})`);
}

// ---------- Reactions ----------

async function resolveSubjectType(subjectId: string): Promise<'issue' | 'comment'> {
  const sql = db();
  const [issueRow] = await sql`select 1 from issues where id = ${subjectId} limit 1`;
  if (issueRow) return 'issue';
  const [commentRow] = await sql`select 1 from comments where id = ${subjectId} limit 1`;
  if (commentRow) return 'comment';
  throw new HttpError(404, 'Reaction subject not found');
}

export async function setReaction(
  profileId: string,
  args: { subjectId: string; content: ReactionContent; on: boolean },
): Promise<Reaction[]> {
  const sql = db();
  const subjectType = await resolveSubjectType(args.subjectId);
  if (args.on) {
    await sql`
      insert into reactions (subject_type, subject_id, content, profile_id)
      values (${subjectType}, ${args.subjectId}, ${args.content}, ${profileId})
      on conflict do nothing
    `;
  } else {
    await sql`
      delete from reactions
      where subject_type = ${subjectType} and subject_id = ${args.subjectId}
        and content = ${args.content} and profile_id = ${profileId}
    `;
  }
  const map = await reactionsForSubjects(subjectType, [args.subjectId], profileId);
  return map.get(args.subjectId) ?? [];
}

// ---------- Sub-issues ----------

/**
 * Attach or detach a sub-issue. `args.issueId` is the parent, `args.subIssueId` the child —
 * same naming as the route body. Re-parenting (attach while already parented elsewhere) just
 * overwrites `parent_issue_id`, same effect as GitHub's `replaceParent: true`.
 */
export async function setSubIssue(
  profileId: string,
  args: { issueId: string; subIssueId: string; attach: boolean },
): Promise<void> {
  await withActor(profileId, (tx) =>
    tx`update issues set parent_issue_id = ${args.attach ? args.issueId : null} where id = ${args.subIssueId}`,
  );
}

// ---------- Activity ----------

export async function getActivity(issueId: string): Promise<ActivityEvent[]> {
  const sql = db();
  const rows = await sql<
    {
      id: string;
      kind: ActivityEvent['kind'];
      createdAt: string;
      body: string | null;
      detail: string | null;
      from: string | null;
      to: string | null;
      url: string | null;
      actorId: string | null;
      actorName: string | null;
      actorAvatarUrl: string | null;
    }[]
  >`
    select af.id, af.kind, af.created_at as "createdAt", af.body, af.detail,
      af.from_value as "from", af.to_value as "to", af.url,
      actor.id as "actorId", actor.display_name as "actorName", actor.avatar_url as "actorAvatarUrl"
    from activity_feed af
    left join profiles actor on actor.id = af.actor_id
    where af.issue_id = ${issueId}
    order by af.created_at asc
  `;
  const commentIds = rows.filter((r) => r.kind === 'comment').map((r) => r.id);
  const reactions = await reactionsForSubjects('comment', commentIds, null);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    createdAt: r.createdAt,
    actor: r.actorId ? { id: r.actorId, name: r.actorName, avatarUrl: r.actorAvatarUrl } : null,
    ...(r.kind === 'comment' ? { body: r.body ?? '', reactions: reactions.get(r.id) ?? [] } : {}),
    ...(r.detail ? { detail: r.detail } : {}),
    ...(r.from ? { from: r.from } : {}),
    ...(r.to ? { to: r.to } : {}),
    ...(r.url ? { url: r.url } : {}),
  }));
}

// ---------- Members ----------

let membersCache: { at: number; value: OrgMember[] } | undefined;

export async function getMembers(): Promise<OrgMember[]> {
  if (membersCache && Date.now() - membersCache.at < SCHEMA_TTL_MS) return membersCache.value;
  const sql = db();
  const rows = await sql<OrgMember[]>`
    select id, display_name as name, avatar_url as "avatarUrl"
    from profiles
    where allowed = true
    order by coalesce(display_name, email)
  `;
  membersCache = { at: Date.now(), value: rows };
  return rows;
}
