/**
 * One-off migration: Slack List CSV → issues directly in Supabase Postgres
 * (supabase/migrations/0001_init.sql). Field-mapping logic mirrors scripts/import-slack-list.ts,
 * but writes straight into Postgres instead of GitHub Projects — the CSV's Assignee/Submitted
 * by/Collaborators columns are already @radiusagent.com emails, so profiles are matched/created
 * by email directly with no login-mapping table needed.
 *
 *   pnpm import:slack:supabase -- --csv "~/Downloads/Bug_tracker (3).csv" --dry-run
 *   pnpm import:slack:supabase -- --csv "~/Downloads/Bug_tracker (3).csv" --limit 20
 *   pnpm import:slack:supabase -- --csv "~/Downloads/Bug_tracker (3).csv"
 *
 * Idempotent via a local checkpoint (.migration/csv-state.json) keyed by a hash of each row's
 * title + submitted date — safe to re-run / resume after a failure.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TransactionSql } from 'postgres';
import { db } from '../api/_lib/db/pool';
import { moduleMap, statusMap } from '../import.config';
import { seedFieldSchema, type FieldMaps } from './_field-schema';

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

// ---------- checkpoint ----------
const STATE_DIR = path.resolve('.migration');
const STATE_FILE = path.join(STATE_DIR, 'csv-state.json');
const done = new Set<string>(existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as string[]) : []);
function markDone(marker: string) {
  done.add(marker);
  if (dryRun) return;
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify([...done], null, 2));
}

// ---------- csv (same lenient parser as import-slack-list.ts) ----------
type Row = Record<string, string | undefined>;

function parseCsv(text: string): string[][] {
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  authorEmail?: string;
  assigneeEmails: string[];
  submittedAt?: string;
  close?: 'COMPLETED' | 'NOT_PLANNED';
}

const isoDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

function parseSubmitted(s: string): string | undefined {
  // "6/18/26, 8:17 AM"
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(s);
  if (!m) return undefined;
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

function mapEmails(s: string): { emails: string[]; unparsed: string[] } {
  const emails: string[] = [];
  const unparsed: string[] = [];
  for (const raw of s.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    if (EMAIL_RE.test(raw)) emails.push(raw.toLowerCase());
    else unparsed.push(raw);
  }
  return { emails: [...new Set(emails)], unparsed };
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

  const submitted = mapEmails(col(r, 'Submitted by'));
  const assignees = mapEmails(col(r, 'Assignee'));
  const collaborators = mapEmails(col(r, 'Collaborators'));

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
  if (submitted.unparsed.length) meta.push(`Submitted by: ${submitted.unparsed.join(', ')}.`);
  if (assignees.unparsed.length) meta.push(`Original assignee: ${assignees.unparsed.join(', ')}.`);
  if (collaborators.emails.length || collaborators.unparsed.length) meta.push(`Collaborators: ${[...collaborators.emails, ...collaborators.unparsed].join(', ')}.`);
  if (col(r, 'Status')) meta.push(`Original status: ${col(r, 'Status')}${col(r, 'Priority') ? ` · priority: ${col(r, 'Priority')}` : ''}.`);
  if (files) meta.push(`Slack files: ${files}.`);
  body.push('---', ...meta.map((m) => `<sub>${m}</sub>`), '', `<!-- slack-row:${marker} -->`);

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
    authorEmail: submitted.emails[0],
    assigneeEmails: assignees.emails,
    submittedAt: parseSubmitted(col(r, 'Date submitted')),
    close: st?.close,
  };
}

// ---------- postgres ----------

function fieldsJsonFor(m: Mapped, maps: FieldMaps): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const single = (fieldName: string, optionName: string | undefined) => {
    if (!optionName) return;
    const fieldId = maps.fieldIdByName.get(fieldName);
    const optionId = maps.optionIdByKey.get(`${fieldName.toLowerCase()}|${optionName.toLowerCase()}`);
    if (fieldId && optionId) out[fieldId] = { optionId };
  };
  single('Status', m.status);
  single('Team', m.team);
  single('Work type', m.type);
  single('Priority', m.priority);
  single('Severity', m.severity);
  single('Module', m.module);
  single('Source', m.source);

  const platformFieldId = maps.fieldIdByName.get('Platform');
  if (platformFieldId && m.platforms.length) {
    const optionIds = m.platforms
      .map((p) => maps.optionIdByKey.get(`platform|${p.toLowerCase()}`))
      .filter((x): x is string => Boolean(x));
    if (optionIds.length) out[platformFieldId] = { optionIds };
  }

  const date = (fieldName: string, v: string | undefined) => {
    const fieldId = maps.fieldIdByName.get(fieldName);
    if (fieldId && v) out[fieldId] = { date: v };
  };
  date('ETA', m.eta);
  date('Release date', m.releaseDate);

  const text = (fieldName: string, v: string | undefined) => {
    const fieldId = maps.fieldIdByName.get(fieldName);
    if (fieldId && v) out[fieldId] = { text: v.slice(0, 1024) };
  };
  text('Brokerage', m.brokerage);
  text('Reported by', m.reportedBy);
  text('Slack link', m.slackLink);

  return out;
}

const profileByEmail = new Map<string, string>();

async function ensureProfile(email: string | undefined): Promise<string | null> {
  if (!email) return null;
  const key = email.toLowerCase();
  const existing = profileByEmail.get(key);
  if (existing) return existing;
  if (dryRun) {
    const id = `dry-run:${key}`;
    profileByEmail.set(key, id);
    return id;
  }
  const sql = db();
  const displayName = key.split('@')[0]!.split('.').map((p) => p[0]!.toUpperCase() + p.slice(1)).join(' ');
  const [row] = await sql<{ id: string }[]>`
    insert into profiles (email, display_name, allowed)
    values (${key}, ${displayName}, false)
    on conflict (email) do nothing
    returning id
  `;
  const id = row?.id ?? (await sql<{ id: string }[]>`select id from profiles where email = ${key}`)[0]!.id;
  profileByEmail.set(key, id);
  return id;
}

/** Bypasses the live-interactive triggers in 0001_init.sql so historical rows don't spam the
 * activity log with "just now, by nobody" assignment events. Mirrors migrate-github-to-supabase.ts. */
function withHistoryTransaction<T>(fn: (tx: TransactionSql) => Promise<T>) {
  return db().begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    return fn(tx);
  });
}

async function importRow(m: Mapped, maps: FieldMaps, position: number): Promise<void> {
  const authorId = await ensureProfile(m.authorEmail);
  const assigneeIds = (await Promise.all(m.assigneeEmails.map((e) => ensureProfile(e)))).filter((x): x is string => Boolean(x));
  const fields = fieldsJsonFor(m, maps);

  const state = m.close ? 'CLOSED' : 'OPEN';
  const stateReason = m.close ?? null;
  const closedAt = m.close ? (m.releaseDate ?? m.submittedAt ?? null) : null;
  const createdAt = m.submittedAt ?? new Date().toISOString();

  if (dryRun) return;

  await withHistoryTransaction(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into issues (title, body, state, state_reason, author_id, created_at, updated_at, closed_at, position, fields)
      values (
        ${m.title}, ${m.body}, ${state}, ${stateReason}, ${authorId},
        ${createdAt}, ${createdAt}, ${closedAt}, ${position}, ${JSON.stringify(fields)}::jsonb
      )
      returning id
    `;
    const issueId = row!.id;
    for (const profileId of assigneeIds) {
      await tx`insert into issue_assignees (issue_id, profile_id) values (${issueId}, ${profileId}) on conflict do nothing`;
    }
  });

  markDone(m.marker);
}

// ---------- main ----------
async function main() {
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
    for (const k of ['status', 'type', 'priority', 'severity', 'module', 'source', 'team', 'platforms', 'close'] as const) {
      console.log(`${k.padEnd(10)} ${count(k)}`);
    }
    console.log(`authorEmail found for ${todo.filter((m) => m.authorEmail).length}/${todo.length} rows`);
    console.log(`assignees   mapped for ${todo.filter((m) => m.assigneeEmails.length).length} rows`);
    console.log(`\nFirst ${Math.min(5, todo.length)} rows:\n`);
    for (const m of todo.slice(0, 5)) {
      console.log(`— ${m.title}`);
      console.log(`  status=${m.status} type=${m.type} priority=${m.priority} severity=${m.severity} module=${m.module} team=${m.team} platforms=${m.platforms.join('+')} close=${m.close}`);
      console.log(`  author=${m.authorEmail} assignees=${m.assigneeEmails.join(', ')} submittedAt=${m.submittedAt}`);
    }
  }

  const maps = await seedFieldSchema(dryRun);
  if (dryRun) {
    console.log(`\nField schema to seed:`);
    for (const [name] of maps.fieldIdByName) console.log(`  ${name}`);
    process.exit(0);
  }

  console.log(`${done.size} rows already imported; ${todo.filter((m) => !done.has(m.marker)).length} to go.\n`);

  let n = 0;
  let failed = 0;
  const started = Date.now();
  for (const [index, m] of todo.entries()) {
    if (done.has(m.marker)) continue;
    n++;
    try {
      await importRow(m, maps, (offset + index) * 1000);
      console.log(`${String(n).padStart(4)} ${(m.status ?? '').padEnd(16)} ${m.title.slice(0, 70)}`);
    } catch (err) {
      failed++;
      console.error(`${String(n).padStart(4)} FAILED ${m.title.slice(0, 60)}: ${err instanceof Error ? err.message : err}`);
      if (failed > 10) {
        console.error('Too many failures, stopping. Re-run to resume (already-done rows are skipped).');
        process.exit(1);
      }
    }
  }
  console.log(`\nImported ${n - failed} issues (${failed} failed) in ${Math.round((Date.now() - started) / 1000)}s.`);
  await db().end();
}

main();
