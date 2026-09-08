/**
 * One-off migration: GitHub Projects v2 (AgentdesksEngine/radius-roadmap #6) → Supabase
 * Postgres (supabase/migrations/0001_init.sql).
 *
 *   pnpm migrate:supabase -- --dry-run                # preview only, no writes
 *   pnpm migrate:supabase -- --dry-run --limit 20      # preview the first 20 issues
 *   pnpm migrate:supabase -- --limit 20                # actually import the first 20
 *   pnpm migrate:supabase                              # everything
 *
 * NOT YET RUN AGAINST A LIVE SUPABASE PROJECT. This needs the dry-run + staging validation
 * pass described in the cutover plan (Phase 1) before it's trusted with production data.
 * Two things specifically need confirming there:
 *
 *   1. `DATABASE_URL` must be a role allowed to run `SET LOCAL session_replication_role =
 *      replica` (Supabase's default `postgres` role can; a restricted custom role might not).
 *      This is how the script writes *historical* activity/state without the live triggers
 *      in 0001_init.sql (built for real-time interactive use) stamping today's date and a
 *      null actor over everything. Every write below runs inside one transaction per issue
 *      that starts with this SET LOCAL — see `withIssueTransaction`.
 *   2. GitHub's `reactions(first: N) { nodes { content user { login } } }` (per-reactor,
 *      used here) is a different field from the `reactionGroups` aggregate that
 *      api/_lib/github/board.ts uses for the live app — confirm the query below still
 *      matches the GitHub API's current shape.
 *
 * Idempotent for issues (upserted by `issues.github_issue_id`). Comments/activity/reactions/
 * labels/assignees have no such shadow column in the schema, so a re-run instead deletes and
 * re-inserts those rows for any issue it touches — safe here because this only ever runs
 * before the app goes live (no real user data exists yet to lose), per the plan's Phase 0-2.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type postgres from 'postgres';
import { getActivity, getBoard, getComments, getSchema } from '../api/_lib/github/board';
import type { GitHubBoardItem } from '../api/_lib/github/board';
import { GitHubGraphQLError } from '../api/_lib/github/gql';
import { HttpError } from '../api/_lib/http';
import { db } from '../api/_lib/db/pool';
import { fields as fieldSpecs } from '../fields.config';
import { emailToLogin } from '../import.config';
import { seedFieldSchema, type FieldMaps } from './_field-schema';
import { scriptClient, sleep } from './_lib';

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? undefined : argv[i + 1];
};
const dryRun = flag('dry-run');
const includeSeedIssues = flag('include-seed-issues');
const force = flag('force');
const limit = Number(opt('limit') ?? Infinity);
const offset = Number(opt('offset') ?? 0);
const skipNumbers = new Set(
  (opt('skip-numbers') ?? (includeSeedIssues ? '' : '1,2,3,4'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
);

// ---------- checkpoint ----------
const STATE_DIR = path.resolve('.migration');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const ID_MAP_FILE = path.join(STATE_DIR, 'id-map.json');

function loadJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}
function saveJson(file: string, value: unknown) {
  if (dryRun) return;
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

const done = new Set<string>(force ? [] : loadJson<string[]>(STATE_FILE, []));
const idMap = new Map<string, string>(Object.entries(loadJson<Record<string, string>>(ID_MAP_FILE, {})));

function markDone(githubIssueId: string) {
  done.add(githubIssueId);
  saveJson(STATE_FILE, [...done]);
}
function recordId(githubIssueId: string, newId: string) {
  idMap.set(githubIssueId, newId);
  saveJson(ID_MAP_FILE, Object.fromEntries(idMap));
}

// ---------- rate-limit backoff (mirrors scripts/import-slack-list.ts) ----------
async function withBackoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const rateLimited =
      (err instanceof HttpError && err.status === 429) ||
      (err instanceof GitHubGraphQLError && err.errors.some((x) => x.type === 'RATE_LIMITED'));
    const secondary = err instanceof Error && /secondary rate limit|abuse/i.test(err.message);
    if ((rateLimited || secondary) && attempt < 6) {
      const wait =
        rateLimited && err instanceof HttpError && err.details && typeof err.details === 'object' && 'resetAt' in err.details && typeof err.details.resetAt === 'number'
          ? Math.max(5_000, err.details.resetAt - Date.now() + 2_000)
          : 60_000 * (attempt + 1);
      console.log(`  rate limited; waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      return withBackoff(fn, attempt + 1);
    }
    throw err;
  }
}

// ---------- per-reactor reactions (board.ts only has aggregate counts) ----------
const REACTIONS_QUERY = /* GraphQL */ `
  query IssueReactions($id: ID!) {
    node(id: $id) {
      ... on Issue {
        reactions(first: 100) {
          nodes {
            content
            user {
              login
            }
          }
        }
        comments(first: 100) {
          nodes {
            id
            reactions(first: 100) {
              nodes {
                content
                user {
                  login
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface RawReactor {
  content: string;
  user: { login: string } | null;
}
interface ReactionsForIssue {
  issue: RawReactor[];
  comments: Record<string, RawReactor[]>;
}

async function getReactorsForIssue(gh: ReturnType<typeof scriptClient>, issueId: string): Promise<ReactionsForIssue> {
  const data = await withBackoff(() =>
    gh.graphql<{
      node: {
        reactions?: { nodes: RawReactor[] };
        comments?: { nodes: { id: string; reactions: { nodes: RawReactor[] } }[] };
      } | null;
    }>(REACTIONS_QUERY, { id: issueId }),
  );
  return {
    issue: data.node?.reactions?.nodes ?? [],
    comments: Object.fromEntries((data.node?.comments?.nodes ?? []).map((c) => [c.id, c.reactions.nodes])),
  };
}

// ---------- Phase 0: field_defs / field_options are seeded by ./_field-schema ----------

function fieldValueJson(maps: FieldMaps, fieldName: string, item: GitHubBoardItem): Record<string, unknown> | undefined {
  const v = item.fields[fieldName];
  if (!v) return undefined;
  switch (v.kind) {
    case 'singleSelect': {
      const id = maps.optionIdByKey.get(`${fieldName.toLowerCase()}|${v.name.toLowerCase()}`);
      return id ? { optionId: id } : undefined;
    }
    case 'multiSelect': {
      const ids = v.options.map((o) => maps.optionIdByKey.get(`${fieldName.toLowerCase()}|${o.name.toLowerCase()}`)).filter((x): x is string => Boolean(x));
      return ids.length ? { optionIds: ids } : undefined;
    }
    case 'date':
      return { date: v.date };
    case 'text':
      return { text: v.text };
    case 'number':
      return { number: v.number };
    default:
      return undefined;
  }
}

// ---------- Phase 0b: labels ----------

async function seedLabels(labels: { name: string; color: string }[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (dryRun) {
    for (const l of labels) map.set(l.name.toLowerCase(), `dry-run:${l.name}`);
    return map;
  }
  const sql = db();
  for (const l of labels) {
    const [row] = await sql<{ id: string }[]>`
      insert into labels (name, color) values (${l.name}, ${l.color})
      on conflict (name) do update set color = excluded.color
      returning id
    `;
    map.set(l.name.toLowerCase(), row!.id);
  }
  return map;
}

// ---------- Phase 0c: profiles (placeholder for every GitHub login we see) ----------

const loginToEmail = new Map(
  Object.entries(emailToLogin)
    .filter(([, login]) => login)
    .map(([email, login]) => [login.toLowerCase(), email]),
);
const unmappedLogins = new Set<string>();

async function ensureProfile(login: string | undefined | null): Promise<string | null> {
  if (!login) return null;
  const key = login.toLowerCase();
  const existing = profileByLogin.get(key);
  if (existing) return existing;

  const email = loginToEmail.get(key);
  if (!email) unmappedLogins.add(login);
  // A synthetic, never-matchable email for logins we couldn't map to a real address, so the
  // placeholder profile can still be created (profiles.email is NOT NULL). Whoever owns this
  // account will need profiles.email hand-corrected before their history is "claimed" by a
  // real sign-in — see the header note and the final report this script prints.
  const placeholderEmail = email ?? `${key}@github.placeholder.${new URL('https://radiusagent.com').hostname}`;

  if (dryRun) {
    const id = `dry-run:${key}`;
    profileByLogin.set(key, id);
    return id;
  }

  const sql = db();
  const [row] = await sql<{ id: string }[]>`
    insert into profiles (email, display_name, github_login, allowed)
    values (${placeholderEmail}, ${login}, ${login}, false)
    on conflict (email) do update set github_login = excluded.github_login
    returning id
  `;
  profileByLogin.set(key, row!.id);
  return row!.id;
}
const profileByLogin = new Map<string, string>();

// ---------- Phase 1+2: extract from GitHub, load into Postgres ----------

function withIssueTransaction<T>(fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return db().begin(async (tx) => {
    // Bypasses supabase/migrations/0001_init.sql's activity/state-sync triggers, which are
    // built to attribute *live* interactive writes — without this, every historical
    // label/assignee/status/parent change below would be re-logged as "just now, by nobody".
    await tx`set local session_replication_role = replica`;
    return fn(tx);
  });
}

async function migrateIssue(
  gh: ReturnType<typeof scriptClient>,
  item: GitHubBoardItem,
  maps: FieldMaps,
  labelIds: Map<string, string>,
  position: number,
): Promise<void> {
  const [comments, activity, reactions] = await Promise.all([
    withBackoff(() => getComments(gh, item.issueId)),
    withBackoff(() => getActivity(gh, item.issueId)),
    getReactorsForIssue(gh, item.issueId),
  ]);

  const authorId = await ensureProfile(item.author?.login);
  const assigneeIds = (await Promise.all(item.assignees.map((a) => ensureProfile(a.login)))).filter((x): x is string => Boolean(x));

  const fieldsJson: Record<string, unknown> = {};
  for (const spec of fieldSpecs) {
    const fieldId = maps.fieldIdByName.get(spec.name)!;
    const v = fieldValueJson(maps, spec.name, item);
    if (v) fieldsJson[fieldId] = v;
  }

  if (dryRun) return;

  await withIssueTransaction(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into issues (
        github_issue_id, number, title, body, state, state_reason,
        author_id, created_at, updated_at, closed_at, is_archived, position, fields
      ) values (
        ${item.issueId}, ${item.number}, ${item.title}, ${item.body}, ${item.state}, ${item.stateReason},
        ${authorId}, ${item.createdAt}, ${item.updatedAt}, ${item.closedAt}, ${item.isArchived},
        ${position}, ${JSON.stringify(fieldsJson)}::jsonb
      )
      on conflict (github_issue_id) do update set
        title = excluded.title, body = excluded.body, state = excluded.state,
        state_reason = excluded.state_reason, author_id = excluded.author_id,
        updated_at = excluded.updated_at, closed_at = excluded.closed_at,
        is_archived = excluded.is_archived, fields = excluded.fields
      returning id
    `;
    const newIssueId = row!.id;
    recordId(item.issueId, newIssueId);

    // Labels / assignees: replace wholesale — see the header note on why re-runs are safe here.
    await tx`delete from issue_labels where issue_id = ${newIssueId}`;
    for (const l of item.labels) {
      const labelId = labelIds.get(l.name.toLowerCase());
      if (labelId) await tx`insert into issue_labels (issue_id, label_id) values (${newIssueId}, ${labelId}) on conflict do nothing`;
    }
    await tx`delete from issue_assignees where issue_id = ${newIssueId}`;
    for (const profileId of assigneeIds) {
      await tx`insert into issue_assignees (issue_id, profile_id) values (${newIssueId}, ${profileId}) on conflict do nothing`;
    }

    // Comments
    await tx`delete from comments where issue_id = ${newIssueId}`;
    const commentIdMap = new Map<string, string>();
    for (const c of comments) {
      const authorProfileId = await ensureProfile(c.author?.login);
      const [cRow] = await tx<{ id: string }[]>`
        insert into comments (issue_id, author_id, body, created_at)
        values (${newIssueId}, ${authorProfileId}, ${c.body}, ${c.createdAt})
        returning id
      `;
      commentIdMap.set(c.id, cRow!.id);
    }

    // Activity events (everything getActivity returned except comments, which are their own table)
    await tx`delete from activity_events where issue_id = ${newIssueId}`;
    for (const e of activity) {
      if (e.kind === 'comment' || e.kind === 'referenced') continue; // no Postgres equivalent for cross-references (see plan)
      const actorId = await ensureProfile(e.actor?.login);
      await tx`
        insert into activity_events (issue_id, kind, actor_id, detail, from_value, to_value, url, created_at)
        values (${newIssueId}, ${e.kind}, ${actorId}, ${e.detail ?? null}, ${e.from ?? null}, ${e.to ?? null}, ${e.url ?? null}, ${e.createdAt})
      `;
    }

    // Reactions (issue-level and per-comment)
    await tx`delete from reactions where subject_type = 'issue' and subject_id = ${newIssueId}`;
    for (const r of reactions.issue) {
      const profileId = await ensureProfile(r.user?.login);
      if (profileId) {
        await tx`
          insert into reactions (subject_type, subject_id, content, profile_id)
          values ('issue', ${newIssueId}, ${r.content}, ${profileId})
          on conflict do nothing
        `;
      }
    }
    for (const [githubCommentId, rs] of Object.entries(reactions.comments)) {
      const newCommentId = commentIdMap.get(githubCommentId);
      if (!newCommentId) continue;
      for (const r of rs) {
        const profileId = await ensureProfile(r.user?.login);
        if (profileId) {
          await tx`
            insert into reactions (subject_type, subject_id, content, profile_id)
            values ('comment', ${newCommentId}, ${r.content}, ${profileId})
            on conflict do nothing
          `;
        }
      }
    }
  });

  markDone(item.issueId);
}

// ---------- main ----------

async function main() {
  const gh = scriptClient();
  console.log(dryRun ? '[dry run] no writes will be made\n' : 'Migrating GitHub → Supabase\n');

  const schema = await withBackoff(() => getSchema(gh, { force: true }));
  const board = await withBackoff(() => getBoard(gh));

  const allItems = board.items
    .filter((i) => !skipNumbers.has(i.number))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const todo = Number.isFinite(limit) ? allItems.slice(offset, offset + limit) : allItems.slice(offset);
  const skippedSeed = board.items.length - allItems.length;

  console.log(`${board.items.length} issues on the board, ${skippedSeed} skipped (--skip-numbers), ${todo.length} in scope for this run.\n`);

  if (dryRun) {
    console.log('Field schema to seed:');
    for (const f of fieldSpecs) console.log(`  ${f.name.padEnd(20)} ${f.type}${'options' in f ? ` (${f.options.length} options)` : ''}`);
    console.log(`\nLabels to seed: ${schema.repository.labels.length}`);
  }

  const maps = await seedFieldSchema(dryRun);
  const labelIds = await seedLabels(schema.repository.labels);

  let n = 0;
  let failed = 0;
  let skippedDone = 0;
  const started = Date.now();
  for (const [index, item] of todo.entries()) {
    if (done.has(item.issueId)) {
      skippedDone++;
      continue;
    }
    n++;
    try {
      await migrateIssue(gh, item, maps, labelIds, (offset + index) * 1000);
      console.log(`${String(n).padStart(4)} ${item.key.padEnd(8)} ${item.title.slice(0, 70)}`);
    } catch (err) {
      failed++;
      console.error(`${String(n).padStart(4)} FAILED ${item.key}: ${err instanceof Error ? err.message : err}`);
      if (failed > 10) {
        console.error('Too many failures, stopping. Re-run to resume (already-done issues are skipped).');
        process.exit(1);
      }
    }
    await sleep(250);
  }

  if (dryRun) {
    console.log(`\n[dry run] would migrate ${todo.length} issues.`);
    if (unmappedLogins.size) {
      console.log(`\n${unmappedLogins.size} GitHub logins have no email in import.config.ts (placeholder profiles get an unclaimable synthetic email):`);
      for (const l of unmappedLogins) console.log(`  ${l}`);
    }
    process.exit(0);
  }

  console.log(`\nImported ${n - failed} issues (${failed} failed, ${skippedDone} already done) in ${Math.round((Date.now() - started) / 1000)}s.`);

  // Pass B: resolve parent_issue_id / sub-issue links now that every issue in this run exists.
  console.log('\nResolving parent/sub-issue links...');
  let unresolvedParents = 0;
  for (const item of todo) {
    if (!item.parent) continue;
    const newIssueId = idMap.get(item.issueId);
    const newParentId = idMap.get(item.parent.id);
    if (!newIssueId) continue;
    if (!newParentId) {
      unresolvedParents++;
      continue;
    }
    await withIssueTransaction(async (tx) => {
      await tx`update issues set parent_issue_id = ${newParentId} where id = ${newIssueId}`;
    });
  }
  console.log(`${unresolvedParents} parent links could not be resolved (parent was skipped or outside this run's scope).`);

  // Sub-issue counters are trigger-maintained live, but the triggers were bypassed above.
  console.log('Recomputing sub-issue progress counters...');
  await db()`
    update issues i set
      sub_issues_total = c.total,
      sub_issues_completed = c.completed
    from (
      select parent_issue_id,
        count(*) as total,
        count(*) filter (where state = 'CLOSED') as completed
      from issues where parent_issue_id is not null
      group by parent_issue_id
    ) c
    where i.id = c.parent_issue_id
  `;

  console.log('Bumping the issue-number sequence past the migrated max...');
  await db()`select setval('issues_number_seq', (select coalesce(max(number), 0) from issues), true)`;

  if (unmappedLogins.size) {
    console.log(`\n${unmappedLogins.size} GitHub logins had no email in import.config.ts — placeholder profiles were created with an unclaimable synthetic email. Update profiles.email for these manually so the person can claim their history on first real sign-in:`);
    for (const l of unmappedLogins) console.log(`  ${l}`);
  }

  await db().end();
}

await main();
