/**
 * Minimal Slack Web API client — just the handful of methods ingest needs, over fetch, with
 * no SDK dependency.
 *
 * Slack's API is "200 OK with `ok: false`" for real errors, so every call has to inspect the
 * body rather than the status. `error: 'missing_scope'` is by far the most common one to hit
 * in this app; the message below names the scope so it is obvious from the Vercel log.
 */
import { HttpError } from '../http.js';

const SLACK_API = 'https://slack.com/api';

export interface SlackMessage {
  type?: string;
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  files?: { id: string; name?: string; mimetype?: string; size?: number; permalink?: string }[];
  subtype?: string;
}

export interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  is_bot?: boolean;
  profile?: { email?: string; real_name?: string; display_name?: string };
}

async function call<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; error?: string; needed?: string } & T;
  if (!json.ok) {
    const scope = json.needed ? ` (needs scope: ${json.needed})` : '';
    throw new HttpError(502, `Slack ${method} failed: ${json.error ?? 'unknown error'}${scope}`);
  }
  return json;
}

export class SlackClient {
  constructor(private readonly token: string) {}

  /** The thread parent plus its replies, oldest first. `ts` may be the parent or any reply. */
  async threadReplies(channel: string, ts: string, limit = 100): Promise<SlackMessage[]> {
    const r = await call<{ messages: SlackMessage[] }>(this.token, 'conversations.replies', {
      channel,
      ts,
      limit,
    });
    return r.messages ?? [];
  }

  /** A single message by ts, via a 1-wide history window. Used when there is no thread. */
  async singleMessage(channel: string, ts: string): Promise<SlackMessage | undefined> {
    const r = await call<{ messages: SlackMessage[] }>(this.token, 'conversations.history', {
      channel,
      latest: ts,
      oldest: ts,
      inclusive: true,
      limit: 1,
    });
    return r.messages?.[0];
  }

  async userInfo(user: string): Promise<SlackUser | undefined> {
    const r = await call<{ user: SlackUser }>(this.token, 'users.info', { user });
    return r.user;
  }

  async permalink(channel: string, messageTs: string): Promise<string | undefined> {
    try {
      const r = await call<{ permalink: string }>(this.token, 'chat.getPermalink', {
        channel,
        message_ts: messageTs,
      });
      return r.permalink;
    } catch {
      // A missing permalink must never sink an ingest — the issue is still worth creating.
      return undefined;
    }
  }

  async postInThread(channel: string, threadTs: string, text: string): Promise<void> {
    await call(this.token, 'chat.postMessage', {
      channel,
      thread_ts: threadTs,
      text,
      unfurl_links: false,
    });
  }

  async addReaction(channel: string, timestamp: string, name: string): Promise<void> {
    try {
      await call(this.token, 'reactions.add', { channel, timestamp, name });
    } catch {
      // already_reacted / no permission — cosmetic only, never fail the ingest for it.
    }
  }

  /**
   * Slack id for an email address, or undefined when nobody in the workspace has it.
   * `users_not_found` is the expected answer for a teammate who never joined Slack, so it is
   * not an error — every other failure still throws.
   */
  async lookupByEmail(email: string): Promise<string | undefined> {
    try {
      const r = await call<{ user?: SlackUser }>(this.token, 'users.lookupByEmail', { email });
      return r.user?.id;
    } catch (err) {
      if (err instanceof Error && err.message.includes('users_not_found')) return undefined;
      throw err;
    }
  }

  /** Opens (or re-opens) the IM channel with a user. Needs the `im:write` scope. */
  async openDm(userId: string): Promise<string | undefined> {
    const r = await call<{ channel?: { id: string } }>(this.token, 'conversations.open', { users: userId });
    return r.channel?.id;
  }

  async postDm(channel: string, text: string): Promise<void> {
    await call(this.token, 'chat.postMessage', { channel, text, unfurl_links: false });
  }
}
