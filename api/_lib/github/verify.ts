/**
 * GitHub webhook signing (https://docs.github.com/webhooks/using-webhooks/validating-webhook-deliveries).
 *
 * Same trap as Slack: the HMAC covers the RAW request bytes, so the caller must pass
 * `readRawBody(req)` and the route must disable Vercel's body parser. Re-serialising
 * `req.body` produces a different string and every delivery fails as "bad signature".
 *
 * Unlike Slack there is no timestamp header to bound replays with — GitHub relies on the
 * signature alone, and the handler is idempotent (a redelivered PR event upserts to the same
 * row and re-applies the same status rule), so a replay is harmless.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http.js';

/** Throws 401 unless the body was signed with the webhook secret. */
export function verifyGithubSignature(args: {
  secret: string;
  signature: string | undefined;
  rawBody: string;
}): void {
  if (!args.signature) throw new HttpError(401, 'Missing X-Hub-Signature-256');

  const expected = `sha256=${createHmac('sha256', args.secret).update(args.rawBody).digest('hex')}`;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(args.signature, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'Bad GitHub signature');
}
