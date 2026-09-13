import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../http.js';
import { verifySlackSignature } from './verify.js';

const signingSecret = 'test-signing-secret';
const rawBody = '{"type":"event_callback","event":{"type":"app_mention"}}';

function sign(timestamp: string, body = rawBody, secret = signingSecret) {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}

describe('verifySlackSignature', () => {
  const now = 1_789_175_129_000;
  const timestamp = String(Math.floor(now / 1000));

  it('accepts a correctly signed, fresh request', () => {
    expect(() =>
      verifySlackSignature({ signingSecret, signature: sign(timestamp), timestamp, rawBody, now }),
    ).not.toThrow();
  });

  it('rejects a body that differs by even one byte', () => {
    expect(() =>
      verifySlackSignature({
        signingSecret,
        signature: sign(timestamp),
        timestamp,
        rawBody: `${rawBody} `,
        now,
      }),
    ).toThrow(HttpError);
  });

  it('rejects a signature made with a different secret', () => {
    expect(() =>
      verifySlackSignature({
        signingSecret,
        signature: sign(timestamp, rawBody, 'wrong'),
        timestamp,
        rawBody,
        now,
      }),
    ).toThrow(/Bad Slack signature/);
  });

  it('rejects a replayed request outside the five-minute window', () => {
    const old = String(Math.floor(now / 1000) - 6 * 60);
    expect(() =>
      verifySlackSignature({ signingSecret, signature: sign(old), timestamp: old, rawBody, now }),
    ).toThrow(/replay window/);
  });

  it('rejects missing or malformed headers instead of throwing on length mismatch', () => {
    expect(() =>
      verifySlackSignature({ signingSecret, signature: undefined, timestamp, rawBody, now }),
    ).toThrow(/Missing Slack signature/);
    expect(() =>
      verifySlackSignature({ signingSecret, signature: 'v0=short', timestamp, rawBody, now }),
    ).toThrow(/Bad Slack signature/);
    expect(() =>
      verifySlackSignature({
        signingSecret,
        signature: sign(timestamp),
        timestamp: 'nope',
        rawBody,
        now,
      }),
    ).toThrow(/Malformed Slack timestamp/);
  });
});
