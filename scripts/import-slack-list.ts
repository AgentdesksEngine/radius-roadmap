/**
 * One-off migration: Slack List CSV → issues in the dedicated repo + project items with fields.
 *
 *   pnpm import:slack -- --csv "~/Downloads/Bug_tracker (3).csv" --dry-run          # preview mapping
 *   pnpm import:slack -- --csv "~/Downloads/Bug_tracker (3).csv" --limit 20        # first 20 rows
 *   pnpm import:slack -- --csv "~/Downloads/Bug_tracker (3).csv"                   # everything
 *
 * Idempotent: every imported issue carries an HTML comment marker derived from the row, and
 * rows whose marker already exists in the repo are skipped. Safe to re-run / resume.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FieldOption, ProjectField, ProjectSchema } from '../shared/types';
import { findProjectItemId, getSchema } from '../api/_lib/github/board';
import { env } from '../api/_lib/env';
import { GitHubGraphQLError } from '../api/_lib/github/gql';
import { HttpError } from '../api/_lib/http';
import { emailToLogin, moduleMap, statusMap } from '../import.config';
import { scriptClient, sleep } from './_lib';

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? undefined : argv[i + 1];
};
const dryRun = flag('dry-run');
const limit = Number(opt('limit') ?? Infinity);
const offset = Number(opt('offset') ?? 0);
const csvPath = (opt('csv') ?? '~/Downloads/Bug_tracker (3).csv').replace(/^~/, os.homedir());

// ---------- csv ----------
type Row = Record<string, string | undefined>;

/** Lenient RFC 4180 parser (Slack exports contain stray quotes that strict parsers reject). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) out.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== '')) out.push(row);
  }
  return out;
}

const table = parseCsv(readFileSync(path.resolve(csvPath), 'utf8'));
const header = (table[0] ?? []).map((h) => h.trim());
const rows: Row[] = table.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()])));
console.log(`${rows.length} rows in ${csvPath}`);

const col = (r: Row, name: string) => (r[name] ?? '').trim();
const lower = (s: string) => s.trim().toLowerCase();

// ---------- mapping ----------
interface Mapped {
  marker: string;
  title: string;
  body: string;
  status?: string;
  type?: string;
  priority?: string;
  severity?: string;
  module?: string;
  source?: string;
  team?: string;
  platforms: string[];
  eta?: string;
  releaseDate?: string;
  brokerage?: string;
  reportedBy?: string;
  slackLink?: string;
  assigneeLogins: string[];
  close?: 'COMPLETED' | 'NOT_PLANNED';
  original: { status: string; priority: string };
}

const isoDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

function parseSubmitted(s: string): string | undefined {
  // "6/18/26, 8:17 AM"
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(s);
  if (!m) return s || undefined;
  const [, mo, d, y, h, mi, ap] = m;
  let hour = Number(h);
  if (ap?.toUpperCase() === 'PM' && hour < 12) hour += 12;
  if (ap?.toUpperCase() === 'AM' && hour === 12) hour = 0;
  const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
  return `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${mi}`;
}

function extractUrls(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.matchAll(/originalUrl":"((?:[^"\\]|\\.)*)"/g)) out.add(m[1]!.replace(/\\\//g, '/'));
  if (!out.size) for (const m of s.matchAll(/https?:\/\/[^\s"'<>)]+/g)) out.add(m[0]);
  return [...out];
}

function mapPeople(s: string): { logins: string[]; unmapped: string[] } {
  const logins: string[] = [];
  const unmapped: string[] = [];
  for (const raw of s.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    const login = emailToLogin[raw.toLowerCase()];
    if (login) logins.push(login);
    else unmapped.push(raw);
  }
  return { logins: [...new Set(logins)], unmapped };
}

function mapRow(r: Row): Mapped | null {
  const rawName = col(r, 'Name');
  if (!rawName || rawName.length < 3) return null;
  const [firstLine, ...restLines] = rawName.split('\n');
  const title = firstLine!.slice(0, 250);
  const marker = createHash('sha1').update(`${rawName}|${col(r, 'Date submitted')}`).digest('hex').slice(0, 12);

  const st = statusMap[lower(col(r, 'Status'))];
  const priorities = col(r, 'Priority').split(',').map(lower);
  let priority: string | undefined;
  let type = st?.type;
  let source: string | undefined;
  if (priorities.includes('critical bug')) {
    priority = 'Urgent';
    type ??= 'Bug';
  } else if (priorities.includes('p1')) priority = 'High';
  if (priorities.includes('new feature')) type = 'Feature request';
  if (priorities.includes('qa reported')) source = 'QA';
  const reportedBy = col(r, 'Reported By(Agent):');
  if (!source && reportedBy) source = lower(reportedBy) === 'qa' ? 'QA' : 'Agent';

  // The Slack list was a bug tracker: anything not marked otherwise is a bug.
  type ??= 'Bug';

  const sev = col(r, 'Severity');
  const severity = ['High', 'Medium', 'Low'].includes(sev) ? sev : undefined;

  const moduleRaw = lower(col(r, 'Module').split(',')[0] ?? '');
  const categoryRaw = lower(col(r, 'Category'));
  let module = moduleMap[moduleRaw];
  if ((!module || module === 'Other') && categoryRaw) module = moduleMap[categoryRaw] ?? module;

  const platforms = col(r, 'Platform')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => ['iOS', 'Android', 'Web'].includes(p));
  const team = platforms.length === 1 ? platforms[0] : undefined;

  const submitted = mapPeople(col(r, 'Submitted by'));
  const assignees = mapPeople(col(r, 'Assignee'));
  const collaborators = mapPeople(col(r, 'Collaborators'));

  const links = [...extractUrls(col(r, 'Link')), ...extractUrls(col(r, 'Details')), ...extractUrls(col(r, 'Design details'))];
  const slackLink = links.find((l) => l.includes('slack.com'));

  const details = col(r, 'Details');
  const design = col(r, 'Design details');
  const files = col(r, 'Files');

  const body: string[] = [];
  if (restLines.length) body.push(restLines.join('\n').trim(), '');
  if (details && !/^https?:\/\/\S+$/.test(details)) body.push(details, '');
  if (links.length) body.push('**Links**', ...links.map((l) => `- ${l}`), '');
  if (design && !links.some((l) => design.includes(l) && design.trim() === l)) body.push('**Design details**', design, '');
  const meta: string[] = [];
  meta.push(`Imported from the Slack List bug tracker (row ${marker}).`);
  const when = parseSubmitted(col(r, 'Date submitted'));
  const submitter = col(r, 'Submitted by');
  if (submitter || when) meta.push(`Submitted ${when ?? ''}${submitter ? ` by ${submitter}` : ''}.`);
  if (assignees.unmapped.length) meta.push(`Original assignee: ${assignees.unmapped.join(', ')}.`);
  if (collaborators.unmapped.length || collaborators.logins.length) meta.push(`Collaborators: ${[...collaborators.logins.map((l) => `@${l}`), ...collaborators.unmapped].join(', ')}.`);
  if (col(r, 'Status')) meta.push(`Original status: ${col(r, 'Status')}${col(r, 'Priority') ? ` · priority: ${col(r, 'Priority')}` : ''}.`);
  if (files) meta.push(`Slack files: ${files}.`);
  body.push('---', ...meta.map((m) => `<sub>${m}</sub>`), '', `<!-- slack-row:${marker} -->`);
  void submitted;

  return {
    marker,
    title,
    body: body.join('\n').trim(),
    status: st?.status,
    type,
    priority,
    severity,
    module,
    source,
    team,
    platforms,
    eta: isoDate(col(r, 'ETA')),
    releaseDate: isoDate(col(r, 'Release date')),
    brokerage: col(r, 'Team Name:') || undefined,
    reportedBy: reportedBy || undefined,
    slackLink,
    assigneeLogins: assignees.logins,
    close: st?.close,
    original: { status: col(r, 'Status'), priority: col(r, 'Priority') },
  };
}

// ---------- github ----------
const gh = scriptClient();
const e = env();

function optionId(schema: ProjectSchema, fieldName: string, optionName: string | undefined): { field: ProjectField; option: FieldOption } | undefined {
  if (!optionName) return undefined;
  const field = schema.fields.find((f) => f.name.toLowerCase() === fieldName.toLowerCase());
  const option = field?.options?.find((o) => o.name.toLowerCase() === optionName.toLowerCase());
  return field && option ? { field, option } : undefined;
}
function fieldId(schema: ProjectSchema, name: string) {
  return schema.fields.find((f) => f.name.toLowerCase() === name.toLowerCase())?.id;
}

async function existingMarkers(): Promise<Set<string>> {
  const out = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const data: {
      repository: { issues: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { body: string }[] } };
    } = await gh.graphql(
      `query($org: String!, $repo: String!, $after: String) {
         repository(owner: $org, name: $repo) {
           issues(first: 100, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
             pageInfo { hasNextPage endCursor }
             nodes { body }
           }
         }
       }`,
      { org: e.GITHUB_ORG, repo: e.GITHUB_ISSUES_REPO, after },
    );
    for (const n of data.repository.issues.nodes) {
      const m = /<!-- slack-row:([0-9a-f]+) -->/.exec(n.body ?? '');
      if (m) out.add(m[1]!);
    }
    if (!data.repository.issues.pageInfo.hasNextPage) break;
    after = data.repository.issues.pageInfo.endCursor;
  }
  return out;
}

async function withBackoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const rateLimited = (err instanceof HttpError && err.status === 429) || (err instanceof GitHubGraphQLError && err.errors.some((x) => x.type === 'RATE_LIMITED'));
    const secondary = err instanceof Error && /secondary rate limit|abuse/i.test(err.message);
    if ((rateLimited || secondary) && attempt < 6) {
      const wait = rateLimited && err instanceof HttpError && err.details && typeof err.details === 'object' && 'resetAt' in err.details && typeof err.details.resetAt === 'number'
        ? Math.max(5_000, err.details.resetAt - Date.now() + 2_000)
        : 60_000 * (attempt + 1);
      console.log(`  rate limited; waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      return withBackoff(fn, attempt + 1);
    }
    throw err;
  }
}

async function importRow(m: Mapped, schema: ProjectSchema, members: Map<string, string>): Promise<string> {
  const assigneeIds = m.assigneeLogins.map((l) => members.get(l.toLowerCase())).filter((x): x is string => Boolean(x));

  const created = await withBackoff(() =>
    gh.graphql<{ createIssue: { issue: { id: string; number: number } } }>(
      `mutation($repositoryId: ID!, $title: String!, $body: String!, $assigneeIds: [ID!], $projectV2Ids: [ID!]) {
         createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body, assigneeIds: $assigneeIds, projectV2Ids: $projectV2Ids }) {
           issue { id number }
         }
       }`,
      { repositoryId: schema.repository.id, title: m.title, body: m.body, assigneeIds, projectV2Ids: [schema.projectId] },
    ),
  );
  const issue = created.createIssue.issue;

  let itemId = await findProjectItemId(gh, issue.id, schema.projectId);
  if (!itemId) {
    const added = await withBackoff(() =>
      gh.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
        `mutation($projectId: ID!, $contentId: ID!) { addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } } }`,
        { projectId: schema.projectId, contentId: issue.id },
      ),
    );
    itemId = added.addProjectV2ItemById.item.id;
  }

  // Batch every field write (and the close) into one aliased mutation.
  const writes: { fieldId: string; value: Record<string, unknown> }[] = [];
  const single = (fieldName: string, optionName: string | undefined) => {
    const r = optionId(schema, fieldName, optionName);
    if (r) writes.push({ fieldId: r.field.id, value: { singleSelectOptionId: r.option.id } });
  };
  single('Status', m.status);
  single('Team', m.team);
  single('Work type', m.type);
  single('Priority', m.priority);
  single('Severity', m.severity);
  single('Module', m.module);
  single('Source', m.source);
  const platformField = schema.fields.find((f) => f.name === 'Platform');
  if (platformField?.options && m.platforms.length) {
    const ids = m.platforms.map((p) => platformField.options!.find((o) => o.name === p)?.id).filter((x): x is string => Boolean(x));
    if (ids.length) writes.push({ fieldId: platformField.id, value: { multiSelectOptionIds: ids } });
  }
  const date = (name: string, v?: string) => {
    const id = fieldId(schema, name);
    if (id && v) writes.push({ fieldId: id, value: { date: v } });
  };
  date('ETA', m.eta);
  date('Release date', m.releaseDate);
  const text = (name: string, v?: string) => {
    const id = fieldId(schema, name);
    if (id && v) writes.push({ fieldId: id, value: { text: v.slice(0, 1024) } });
  };
  text('Brokerage', m.brokerage);
  text('Reported by', m.reportedBy);
  text('Slack link', m.slackLink);

  const vars: Record<string, unknown> = { projectId: schema.projectId, itemId, issueId: issue.id };
  const decls = ['$projectId: ID!', '$itemId: ID!', '$issueId: ID!'];
  const ops: string[] = [];
  writes.forEach((w, i) => {
    decls.push(`$f${i}: ID!`, `$v${i}: ProjectV2FieldValue!`);
    vars[`f${i}`] = w.fieldId;
    vars[`v${i}`] = w.value;
    ops.push(`s${i}: updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $f${i}, value: $v${i} }) { projectV2Item { id } }`);
  });
  if (m.close) {
    decls.push('$reason: IssueClosedStateReason!');
    vars.reason = m.close;
    ops.push(`close: closeIssue(input: { issueId: $issueId, stateReason: $reason }) { issue { id } }`);
  }
  if (ops.length) {
    await withBackoff(() => gh.graphql(`mutation(${decls.join(', ')}) { ${ops.join('\n')} }`, vars));
  }
  return `#${issue.number}`;
}

// ---------- main ----------
const mapped = rows.map(mapRow);
const skippedEmpty = mapped.filter((m) => !m).length;
const usable = mapped.filter((m): m is Mapped => Boolean(m));
const todo = Number.isFinite(limit) ? usable.slice(offset, offset + limit) : usable.slice(offset);

if (dryRun) {
  console.log(`\n[dry run] ${todo.length} rows would be imported (${skippedEmpty} rows without a usable Name skipped).\n`);
  const count = (k: keyof Mapped) => {
    const c = new Map<string, number>();
    for (const m of todo) {
      const v: unknown = m[k];
      const key = v == null || (Array.isArray(v) && !v.length) ? '(none)' : Array.isArray(v) ? v.join('+') : String(v);
      c.set(key, (c.get(key) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(', ');
  };
  for (const k of ['status', 'type', 'priority', 'severity', 'module', 'source', 'team', 'platforms', 'close'] as const) console.log(`${k.padEnd(10)} ${count(k)}`);
  console.log(`assignees  mapped for ${todo.filter((m) => m.assigneeLogins.length).length} rows`);
  console.log(`\nFirst ${Math.min(5, todo.length)} rows:\n`);
  for (const m of todo.slice(0, 5)) {
    console.log(`— ${m.title}`);
    console.log(`  status=${m.status} type=${m.type} priority=${m.priority} severity=${m.severity} module=${m.module} team=${m.team} platforms=${m.platforms.join('+')} close=${m.close}`);
    console.log(`  eta=${m.eta} release=${m.releaseDate} brokerage=${m.brokerage} reportedBy=${m.reportedBy} slack=${m.slackLink}`);
    console.log(m.body.split('\n').map((l) => `  | ${l}`).join('\n'));
    console.log();
  }
  process.exit(0);
}

const schema = await getSchema(gh, { force: true });
const membersData = await gh.graphql<{ organization: { membersWithRole: { nodes: { id: string; login: string }[] } } }>(
  `query($org: String!) { organization(login: $org) { membersWithRole(first: 100) { nodes { id login } } } }`,
  { org: e.GITHUB_ORG },
);
const members = new Map(membersData.organization.membersWithRole.nodes.map((m) => [m.login.toLowerCase(), m.id]));
const done = await existingMarkers();
console.log(`${done.size} rows already imported; ${todo.filter((m) => !done.has(m.marker)).length} to go.\n`);

let n = 0;
let failed = 0;
const started = Date.now();
for (const m of todo) {
  if (done.has(m.marker)) continue;
  n++;
  try {
    const ref = await importRow(m, schema, members);
    console.log(`${String(n).padStart(4)} ${ref.padEnd(6)} ${m.status?.padEnd(16) ?? ''.padEnd(16)} ${m.title.slice(0, 70)}`);
  } catch (err) {
    failed++;
    console.error(`${String(n).padStart(4)} FAILED ${m.title.slice(0, 60)}: ${err instanceof Error ? err.message : err}`);
    if (failed > 10) {
      console.error('Too many failures, stopping. Re-run to resume.');
      process.exit(1);
    }
  }
  await sleep(1000);
}
console.log(`\nImported ${n - failed} issues (${failed} failed) in ${Math.round((Date.now() - started) / 1000)}s.`);
