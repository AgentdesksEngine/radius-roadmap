/**
 * Every Slack trigger, in ONE Vercel function.
 *
 * That is not tidiness, it is a hard constraint: this route is the 10th of Vercel's 12-function
 * cap, and splitting it into /events, /interactivity and /commands would blow straight through
 * it. The `[action]` segment dispatches instead:
 *
 *   POST /api/slack/events         → Events API   (app_mention, reaction_added)
 *   POST /api/slack/interactivity  → message shortcut ("Add to bug tracker")
 *
 * All three triggers converge on ingestSlackMessage(), so they cannot drift apart in what
 * they capture. The thread parent is always the bug; the trigger only says "that one".
 *
 * Timing: Slack gives us 3 seconds to ack or it retries (3x, then gives up). Fetching a
 * thread, resolving users and inserting will not reliably fit, so we ack first and finish the
 * work in `waitUntil`. Retries are harmless anyway — ingest is idempotent on (channel, ts) —
 * but a 3s-timeout loop would still triple the Slack API calls for nothing.
 */
import type { VercelResponse } from '@vercel/node';
import { requireSlackEnv, slackIngestChannels, env } from '../_lib/env.js';
import { HttpError, param, readRawBody, route } from '../_lib/http.js';
import { SlackClient, type SlackMessage, type SlackUser } from '../_lib/slack/client.js';
import { ingestSlackMessage, parseAddCommand } from '../_lib/slack/ingest.js';
import { verifySlackSignature } from '../_lib/slack/verify.js';

/** Runs `fn` after the response is sent, keeping the invocation alive on Vercel. */
async function afterResponse(fn: () => Promise<void>): Promise<void> {
  const run = fn().catch((err) => console.error('[slack] background work failed:', err));
  try {
    const { waitUntil } = await import('@vercel/functions');
    waitUntil(run);
  } catch {
    // Local dev (scripts/dev-api.ts) has no platform to hand the promise to — just await.
    await run;
  }
}

// ---------- shared capture path ----------

interface Trigger {
  channelId: string;
  /** ts of the message the user pointed at — may be a reply, may be the parent. */
  ts: string;
  /** ts of the thread it belongs to, when known. */
  threadTs?: string;
  /** Free text typed with the command, e.g. "p1 cda ios". */
  hintText: string;
}

async function capture(trigger: Trigger): Promise<void> {
  const e = requireSlackEnv();
  const allowed = slackIngestChannels();
  if (allowed.size && !allowed.has(trigger.channelId)) {
    console.log(`[slack] ignoring trigger in ${trigger.channelId} (not in SLACK_INGEST_CHANNELS)`);
    return;
  }

  const slack = new SlackClient(e.SLACK_BOT_TOKEN);

  // The thread parent is the bug report. conversations.replies accepts any ts in the thread
  // and always returns the parent first, which is exactly the resolution we need.
  const rootTs = trigger.threadTs ?? trigger.ts;
  let messages: SlackMessage[] = await slack.threadReplies(trigger.channelId, rootTs);
  if (!messages.length) {
    const single = await slack.singleMessage(trigger.channelId, trigger.ts);
    messages = single ? [single] : [];
  }
  const parent = messages[0];
  if (!parent) throw new HttpError(404, `No Slack message at ${trigger.channelId}/${rootTs}`);

  // Resolve display names once for everyone in the thread, so quoted replies read as names.
  const userIds = new Set<string>();
  for (const m of messages) if (m.user) userIds.add(m.user);
  const userNames = new Map<string, string>();
  const users = new Map<string, SlackUser>();
  await Promise.all(
    [...userIds].map(async (id) => {
      try {
        const u = await slack.userInfo(id);
        if (u) {
          users.set(id, u);
          userNames.set(id, u.profile?.real_name ?? u.real_name ?? u.name ?? id);
        }
      } catch {
        // A name we cannot resolve is cosmetic — fall through to the raw id.
      }
    }),
  );

  const permalink = await slack.permalink(trigger.channelId, parent.ts);
  const reporter = parent.user ? users.get(parent.user) : undefined;

  const { item, created } = await ingestSlackMessage({
    channelId: trigger.channelId,
    parent,
    replies: messages,
    hintText: trigger.hintText,
    permalink,
    reporter,
    userNames,
  });

  // item.key / item.url come from db/board.ts's issueUrl(), so this link stays correct if the
  // app's issue route ever changes shape.
  await slack.postInThread(
    trigger.channelId,
    rootTs,
    created
      ? `:white_check_mark: Tracked as <${item.url}|${item.key}> — _${item.title}_\nIt's in *Intake* now; set Team, Priority and Work type there to move it onto the board.`
      : `:information_source: Already tracked as <${item.url}|${item.key}> — _${item.title}_`,
  );
  if (created) await slack.addReaction(trigger.channelId, parent.ts, 'eyes');
}

// ---------- Events API ----------

interface SlackEvent {
  type: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  reaction?: string;
  item?: { type: string; channel: string; ts: string };
}

async function handleEvents(res: VercelResponse, rawBody: string): Promise<void> {
  const payload = JSON.parse(rawBody) as { type: string; challenge?: string; event?: SlackEvent };

  // One-time endpoint handshake when you paste the Request URL into the Slack app config.
  if (payload.type === 'url_verification') {
    res.status(200).json({ challenge: payload.challenge });
    return;
  }

  res.status(200).end(); // ack inside the 3s budget, then work

  // Past this point the response is closed, so nothing may throw out of here — route()'s error
  // handler would try to write a 500 onto a finished response and mask the real failure.
  try {
    const event = payload.event;
    if (!event) return;
    const e = env();
    if (event.bot_id || (e.SLACK_BOT_USER_ID && event.user === e.SLACK_BOT_USER_ID)) return; // never react to ourselves

    if (event.type === 'app_mention' && event.channel && event.ts) {
      // "@bugtracker add p1 cda" — a mention that is not an `add` command is not ours to act on.
      const hintText = parseAddCommand(event.text ?? '', e.SLACK_BOT_USER_ID);
      if (hintText === null) return;
      await afterResponse(() =>
        capture({ channelId: event.channel!, ts: event.ts!, threadTs: event.thread_ts, hintText }),
      );
      return;
    }

    if (event.type === 'reaction_added' && event.item?.type === 'message') {
      if (event.reaction !== e.SLACK_TRIGGER_EMOJI) return;
      await afterResponse(() =>
        capture({ channelId: event.item!.channel, ts: event.item!.ts, hintText: '' }),
      );
    }
  } catch (err) {
    console.error('[slack] event dispatch failed after ack:', err);
  }
}

// ---------- Interactivity (message shortcut) ----------

interface ShortcutPayload {
  type: string;
  callback_id?: string;
  channel?: { id: string };
  message?: { ts: string; thread_ts?: string };
  message_ts?: string;
  user?: { id: string };
}

async function handleInteractivity(res: VercelResponse, rawBody: string): Promise<void> {
  // Interactivity arrives form-encoded with the JSON in a `payload` field.
  const encoded = new URLSearchParams(rawBody).get('payload');
  if (!encoded) throw new HttpError(400, 'Missing interactivity payload');
  const payload = JSON.parse(encoded) as ShortcutPayload;

  res.status(200).end();

  try {
    if (payload.type !== 'message_action') return;
    const channelId = payload.channel?.id;
    const ts = payload.message?.ts ?? payload.message_ts;
    if (!channelId || !ts) return;

    await afterResponse(() =>
      capture({ channelId, ts, threadTs: payload.message?.thread_ts, hintText: '' }),
    );
  } catch (err) {
    console.error('[slack] shortcut dispatch failed after ack:', err);
  }
}

// ---------- route ----------

export default route({
  POST: async (req, res) => {
    const e = requireSlackEnv();
    const rawBody = await readRawBody(req);
    verifySlackSignature({
      signingSecret: e.SLACK_SIGNING_SECRET,
      signature: req.headers['x-slack-signature'] as string | undefined,
      timestamp: req.headers['x-slack-request-timestamp'] as string | undefined,
      rawBody,
    });

    const action = param(req, 'action');
    if (action === 'events') return handleEvents(res, rawBody);
    if (action === 'interactivity') return handleInteractivity(res, rawBody);
    throw new HttpError(404, `Unknown Slack action "${action}"`);
  },
});

/**
 * Vercel parses JSON bodies by default, and a parsed body cannot be re-serialised back into
 * the exact bytes Slack signed. Turning the parser off is what makes readRawBody() truthful.
 */
export const config = { api: { bodyParser: false } };
