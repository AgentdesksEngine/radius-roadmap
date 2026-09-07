import { createHmac, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isValidSignature } from './github';
import { appJwt, normalizePrivateKey } from '../_lib/github/app';

const SECRET = 'a-shared-secret';
const BODY = '{"action":"edited","issue":{"number":42}}';
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('webhook signatures', () => {
  it('accepts a body signed with the configured secret', () => {
    expect(isValidSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it('rejects a body that was altered in flight', () => {
    expect(isValidSignature(`${BODY} `, sign(BODY), SECRET)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    expect(isValidSignature(BODY, sign(BODY, 'not-our-secret'), SECRET)).toBe(false);
  });

  it('rejects a missing or truncated header instead of throwing', () => {
    expect(isValidSignature(BODY, undefined, SECRET)).toBe(false);
    expect(isValidSignature(BODY, 'sha256=abc', SECRET)).toBe(false);
    expect(isValidSignature(BODY, '', SECRET)).toBe(false);
  });
});

describe('app JWT', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  it('unescapes a PEM that was pasted onto one line', () => {
    const oneLine = privateKey.replace(/\n/g, '\\n');
    expect(normalizePrivateKey(oneLine)).toBe(privateKey);
    expect(normalizePrivateKey(privateKey)).toBe(privateKey);
  });

  it('signs a JWT whose claims GitHub will accept', () => {
    const now = Date.parse('2026-09-07T12:00:00Z');
    const token = appJwt('123456', privateKey, now);
    const [header, payload, signature] = token.split('.');

    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    expect(claims.iss).toBe('123456');
    // Backdated for clock skew, and inside GitHub's 10-minute ceiling.
    expect(claims.iat).toBe(Math.floor(now / 1000) - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(signature).toBeTruthy();
  });
});
