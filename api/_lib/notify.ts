/**
 * Slack DMs for issue activity: who hears about what, and when.
 *
 * Three rules shape everything here.
 *
 * 1. A DM goes to a *person*, never a channel, so the only recipients are watchers of the
 *    issue plus anyone @mentioned in the text that triggered the event — minus whoever
 *    caused it. Nobody is ever told about their own click.
 * 2. Events are batched. `enqueue()` appends to an open row in `notification_outbox` rather
 *    than sending, and `flushDue()` turns a whole batch into one "3 updates on RAD-42" DM
 *    once the coalescing window has passed. The partial unique index in migration 0004 is
 *    what makes the append an upsert.
 * 3. Slack is best-effort. An unmatched email, a missing scope, a Slack outage — all of it is
 *    logged and dropped. A notification must never fail the write that produced it, and must
 *    never surface as an error to the person doing the writing.
 *
 * Draining: a worker started by `notifySoon()` sleeps out the window and flushes, but a
 * serverless invocation is not guaranteed to live that long, so `flushDue()` is *also* swept
 * opportunistically from the board endpoint (api/project/[action].ts). Whichever gets there
 * first wins — the claim UPDATE is atomic, so a batch cannot be sent twice.
 */
import { afterResponse, sleep } from './after.js';
import { asJson, db } from './db/pool.js';
import { env } from './env.js';
import { SlackClient } from './slack/client.js';
import type { TransactionSql } from 'postgres';

export type NotificationKind = 'mention' | 'assigned' | 'status' | 'comment' | 'closed' | 'pr';

export interface NotificationEvent {
  kind: NotificationKind;
  /** Display name of whoever caused it, or null for machine events (a PR webhook). */
  actor: string | null;
  detail?: string;
  at: string;
}

export type WatcherSource = 'manual' | 'author' | 'assignee' | 'comment' | 'mention';

/** How long events keep collecting into one DM. */
export const NOTIFY_WINDOW_MS = 2 * 60_000;

/** A single serverless invocation cannot be trusted past this, so the worker sleeps in slices. */
const SLEEP_SLICE_MS = 20_000;

const FLUSH_BATCH = 50;

// ---------- pure helpers (unit-tested) ----------

/**
 * Mentions are stored in the comment markdown as `[@Jane Doe](mention:<profile uuid>)` — the
 * picker writes the id, so display names can change without breaking the link, and parsing
 * never has to guess at a name.
 */
const MENTION_RE = /\[@[^\]\n]*\]\(mention:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

export function parseMentions(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) out.add(m[1]!.toLowerCase());
  return [...out];
}

/** Watchers ∪ mentions, minus the actor. */
export function recipientsFor(args: {
  watchers: string[];
  mentions?: string[];
  actorId: string | null;
}): string[] {
  const set = new Set([...args.watchers, ...(args.mentions ?? [])]);
  if (args.actorId) set.delete(args.actorId);
  return [...set];
}

function eventLine(e: NotificationEvent): string {
  const who = e.actor ?? 'Someone';
  switch (e.kind) {
    case 'mention':
      return `${who} mentioned you`;
    case 'comment':
      return `${who} commented`;
    case 'assigned':
      return e.detail ? `${who} changed the assignees to ${e.detail}` : `${who} changed the assignees`;
    case 'status':
      return e.detail ? `${who} moved it to ${e.detail}` : `${who} changed the status`;
    case 'closed':
      return e.detail ? `${who} ${e.detail}` : `${who} closed it`;
    case 'pr':
      return e.detail ?? 'A pull request was updated';
  }
}

/** The DM body. One event reads as a sentence; several collapse into a counted list. */
export function formatDigest(args: {
  key: string;
  title: string;
  url: string;
  events: NotificationEvent[];
}): string {
  const lines = [`*${args.key}* ${args.title}`];
  if (args.events.length === 1) {
    lines.push(eventLine(args.events[0]!));
  } else {
    lines.push(`${args.events.length} updates on ${args.key}:`);
    for (const e of args.events) lines.push(`• ${eventLine(e)}`);
  }
  lines.push(args.url);
  return lines.join('\n');
}

// ---------- watchers ----------

/**
 * Subscribes people to an issue. Existing rows are left alone so an explicit manual watch is
 * never relabelled as an incidental one, and an unwatch is never silently undone by the same
 * person commenting again... which is exactly why unwatching writes a row-delete, not a flag:
 * re-subscribing on the next comment is the intended behaviour.
 */
export async function ensureWatchers(
  tx: TransactionSql,
  issueId: string,
  entries: { profileId: string; source: WatcherSource }[],
): Promise<void> {
  for (const { profileId, source } of entries) {
    if (!profileId) continue;
    // Selected from `profiles` rather than inserted as a literal: a mention token can carry
    // any uuid the markdown happens to contain, and an FK violation here would roll back the
    // comment that produced it.
    await tx`
      insert into issue_watchers (issue_id, profile_id, source)
      select ${issueId}, p.id, ${source} from profiles p where p.id = ${profileId}
      on conflict (issue_id, profile_id) do nothing
    `;
  }
}

export async function watchersOf(issueId: string): Promise<string[]> {
  const rows = await db()<{ profileId: string }[]>`
    select profile_id as "profileId" from issue_watchers where issue_id = ${issueId}
  `;
  return rows.map((r) => r.profileId);
}

export async function setWatching(profileId: string, issueId: string, watching: boolean): Promise<number> {
  const sql = db();
  if (watching) {
    await sql`
      insert into issue_watchers (issue_id, profile_id, source)
      values (${issueId}, ${profileId}, 'manual')
      on conflict (issue_id, profile_id) do nothing
    `;
  } else {
    await sql`delete from issue_watchers where issue_id = ${issueId} and profile_id = ${profileId}`;
  }
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from issue_watchers where issue_id = ${issueId}
  `;
  return row?.count ?? 0;
}

// ---------- enqueue ----------

async function actorName(profileId: string | null): Promise<string | null> {
  if (!profileId) return null;
  const [row] = await db()<{ name: string | null; email: string }[]>`
    select display_name as name, email from profiles where id = ${profileId}
  `;
  return row ? (row.name ?? row.email) : null;
}

/**
 * Records one event for every interested person. Never throws: a broken notification is not
 * a reason to fail the comment or the field write that caused it.
 */
export async function enqueue(args: {
  issueId: string;
  actorId: string | null;
  kind: NotificationKind;
  detail?: string;
  /** Profile ids mentioned in the triggering text, already parsed. */
  mentions?: string[];
}): Promise<void> {
  try {
    const watchers = await watchersOf(args.issueId);
    const to = recipientsFor({ watchers, mentions: args.mentions, actorId: args.actorId });
    if (!to.length) return;

    const event: NotificationEvent = {
      kind: args.kind,
      actor: await actorName(args.actorId),
      ...(args.detail ? { detail: args.detail } : {}),
      at: new Date().toISOString(),
    };

    const sql = db();
    for (const profileId of to) {
      const mentioned = args.mentions?.includes(profileId);
      const perPerson: NotificationEvent = mentioned && args.kind === 'comment' ? { ...event, kind: 'mention' } : event;
      await sql`
        insert into notification_outbox (issue_id, profile_id, events, flush_after)
        select ${args.issueId}, p.id, ${sql.json(asJson([perPerson]))}::jsonb,
          now() + ${`${NOTIFY_WINDOW_MS} milliseconds`}::interval
        from profiles p where p.id = ${profileId}
        on conflict (issue_id, profile_id) where sent_at is null
        do update set events = notification_outbox.events || excluded.events
      `;
    }
  } catch (err) {
    console.error('[notify] enqueue failed:', err);
  }
}

// ---------- flush ----------

interface DueRow {
  id: string;
  events: NotificationEvent[];
  profileId: string;
  number: number;
  title: string;
  email: string;
  slackUserId: string | null;
  slackDmChannelId: string | null;
}

/**
 * Sends every batch whose window has closed. Rows are claimed by the same UPDATE that reads
 * them, so two concurrent flushes (the sleeping worker and an opportunistic sweep) cannot
 * both send the same digest.
 */
export async function flushDue(): Promise<number> {
  const e = env();
  if (!e.SLACK_BOT_TOKEN) return 0;

  const sql = db();
  const rows = await sql<DueRow[]>`
    with claimed as (
      update notification_outbox o
      set sent_at = now()
      where o.id in (
        select id from notification_outbox
        where sent_at is null and flush_after <= now()
        order by flush_after
        limit ${FLUSH_BATCH}
        for update skip locked
      )
      returning o.id, o.issue_id, o.profile_id, o.events
    )
    select c.id, c.events, c.profile_id as "profileId",
      i.number, i.title,
      p.email, p.slack_user_id as "slackUserId", p.slack_dm_channel_id as "slackDmChannelId"
    from claimed c
    join issues i on i.id = c.issue_id
    join profiles p on p.id = c.profile_id
  `;
  if (!rows.length) return 0;

  const prefix = e.ISSUE_KEY_PREFIX;
  const slack = new SlackClient(e.SLACK_BOT_TOKEN);
  let sent = 0;

  for (const row of rows) {
    try {
      const channel = await dmChannelFor(slack, {
        profileId: row.profileId,
        email: row.email,
        slackUserId: row.slackUserId,
        slackDmChannelId: row.slackDmChannelId,
      });
      if (!channel) continue;
      const key = `${prefix}-${row.number}`;
      await slack.postDm(
        channel,
        formatDigest({ key, title: row.title, url: `${e.appUrl}/issue/${key}`, events: row.events }),
      );
      sent++;
    } catch (err) {
      // Already claimed, so this digest is lost rather than retried forever. Losing one DM
      // beats a poison row re-sending on every sweep.
      console.error('[notify] DM failed:', err);
    }
  }
  return sent;
}

/**
 * Resolves (and caches on the profile) the IM channel to DM. Returns undefined when the
 * person has no Slack account matching their email — the documented silent skip.
 */
async function dmChannelFor(
  slack: SlackClient,
  profile: { profileId: string; email: string; slackUserId: string | null; slackDmChannelId: string | null },
): Promise<string | undefined> {
  if (profile.slackDmChannelId) return profile.slackDmChannelId;

  const sql = db();
  let userId = profile.slackUserId ?? undefined;
  if (!userId) {
    userId = await slack.lookupByEmail(profile.email);
    if (!userId) return undefined;
    await sql`update profiles set slack_user_id = ${userId} where id = ${profile.profileId}`;
  }
  const channel = await slack.openDm(userId);
  if (!channel) return undefined;
  await sql`update profiles set slack_dm_channel_id = ${channel} where id = ${profile.profileId}`;
  return channel;
}

/**
 * Starts a background worker that sleeps out the coalescing window and flushes. Sliced so a
 * short-lived invocation still delivers everything that came due while it was alive.
 */
let workerRunning = false;

export function notifySoon(): void {
  // One worker per instance. A bulk field write enqueues for a hundred issues at once and
  // would otherwise start a hundred sleepers, all flushing the same table.
  if (workerRunning) return;
  workerRunning = true;
  void afterResponse(async () => {
    try {
      const deadline = Date.now() + NOTIFY_WINDOW_MS + SLEEP_SLICE_MS;
      while (Date.now() < deadline) {
        await sleep(Math.min(SLEEP_SLICE_MS, deadline - Date.now()));
        await flushDue();
      }
    } finally {
      workerRunning = false;
    }
  }, 'notify');
}

let lastSweep = 0;

/** Opportunistic drain from a hot read path. Throttled per instance, never awaited. */
export function sweepNotifications(minIntervalMs = 15_000): void {
  if (Date.now() - lastSweep < minIntervalMs) return;
  lastSweep = Date.now();
  void afterResponse(async () => {
    await flushDue();
  }, 'notify-sweep');
}
