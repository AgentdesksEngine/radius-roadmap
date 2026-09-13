/**
 * A webhook endpoint that accepts unsigned bodies is an open write API into the issue
 * tracker, so these are the tests that matter most in this directory.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../http.js';
import { verifyGithubSignature } from './verify.js';

const SECRET = 'shhh';
const BODY = JSON.stringify({ action: 'opened', pull_request: { number: 12 } });

function sign(body: string, secret = SECRET) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifyGithubSignature', () => {
  it('accepts a body signed with the webhook secret', () => {
    expect(() => verifyGithubSignature({ secret: SECRET, signature: sign(BODY), rawBody: BODY })).not.toThrow();
  });

  it('rejects a body signed with the wrong secret', () => {
    expect(() =>
      verifyGithubSignature({ secret: SECRET, signature: sign(BODY, 'wrong'), rawBody: BODY }),
    ).toThrow(HttpError);
  });

  it('rejects a body that was changed after signing', () => {
    const signature = sign(BODY);
    expect(() =>
      verifyGithubSignature({ secret: SECRET, signature, rawBody: BODY.replace('12', '13') }),
    ).toThrow(/Bad GitHub signature/);
  });

  it('rejects a missing signature header rather than treating it as unsigned', () => {
    expect(() => verifyGithubSignature({ secret: SECRET, signature: undefined, rawBody: BODY })).toThrow(
      /Missing X-Hub-Signature-256/,
    );
  });

  it('rejects a truncated signature without throwing on the length mismatch', () => {
    expect(() =>
      verifyGithubSignature({ secret: SECRET, signature: sign(BODY).slice(0, 20), rawBody: BODY }),
    ).toThrow(HttpError);
  });

  it('is byte-exact: re-serialising the JSON breaks the signature', () => {
    const signature = sign(BODY);
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(() => verifyGithubSignature({ secret: SECRET, signature, rawBody: reserialised })).toThrow(HttpError);
  });
});
