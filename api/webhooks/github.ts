import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../_lib/env.js';
import { HttpError, readRawBody, route } from '../_lib/http.js';
import { invalidateBoard } from '../_lib/board-cache.js';

/** Vercel must not consume the stream: the signature covers the original bytes. */
export const config = { api: { bodyParser: false } };

/**
 * Events that can change what the board shows. Anything else GitHub sends is acknowledged
 * and ignored — a 2xx keeps the delivery out of the App's failed-delivery list.
 */
const WATCHED = new Set([
  'issues',
  'issue_comment',
  'projects_v2_item',
  'sub_issues',
  'label',
  'ping',
]);

export function isValidSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // Compare lengths first: timingSafeEqual throws on a mismatch rather than returning false.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/webhooks/github
 *
 * Turns a 60-second poll into a push. The payload is not merged into the cache — a webhook
 * body has no project field values in it — it just marks the cached board stale, so the
 * next read delta-syncs instead of waiting out its freshness window.
 */
export default route({
  POST: async (req, res) => {
    const secret = env().GITHUB_WEBHOOK_SECRET;
    if (!secret) throw new HttpError(503, 'Webhooks are not configured');

    const raw = await readRawBody(req);
    const signature = req.headers['x-hub-signature-256'];
    if (!isValidSignature(raw, Array.isArray(signature) ? signature[0] : signature, secret)) {
      throw new HttpError(401, 'Bad signature');
    }

    const event = String(req.headers['x-github-event'] ?? '');
    if (event === 'ping') {
      res.status(200).json({ ok: true, pong: true });
      return;
    }
    if (WATCHED.has(event)) invalidateBoard();
    res.status(200).json({ ok: true, event, invalidated: WATCHED.has(event) });
  },
});
