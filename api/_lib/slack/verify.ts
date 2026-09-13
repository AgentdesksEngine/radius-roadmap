/**
 * Slack request signing (https://docs.slack.dev/authentication/verifying-requests-from-slack).
 *
 * Two things here are easy to get wrong and both fail closed, silently, in ways that look like
 * "Slack isn't calling us":
 *   1. The HMAC is over the RAW request bytes. Re-serialising the parsed JSON does not
 *      reproduce them (key order, whitespace, unicode escapes), so the caller must hand us
 *      `readRawBody(req)` — never `JSON.stringify(req.body)`.
 *   2. Slack sends interactivity and slash payloads as `application/x-www-form-urlencoded`,
 *      not JSON, so the raw body is what gets parsed downstream too.
 *
 * The timestamp window is what stops a captured request being replayed later.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http.js';

/** Slack's own recommendation: reject anything older than five minutes. */
const MAX_SKEW_SECONDS = 5 * 60;

export interface SignatureInput {
  signingSecret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: string;
  /** Injectable for tests; epoch milliseconds. */
  now?: number;
}

/** Throws 401 unless the request genuinely came from Slack within the replay window. */
export function verifySlackSignature({
  signingSecret,
  signature,
  timestamp,
  rawBody,
  now = Date.now(),
}: SignatureInput): void {
  if (!signature || !timestamp) throw new HttpError(401, 'Missing Slack signature headers');

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) throw new HttpError(401, 'Malformed Slack timestamp');
  if (Math.abs(now / 1000 - ts) > MAX_SKEW_SECONDS)
    throw new HttpError(401, 'Slack timestamp outside replay window');

  const expected = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;

  // Compare as bytes of equal length — timingSafeEqual throws on a length mismatch.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new HttpError(401, 'Bad Slack signature');
}
