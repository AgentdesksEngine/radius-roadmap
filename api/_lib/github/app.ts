/**
 * GitHub App installation auth.
 *
 * Reads go through the App's own installation token rather than the signed-in user's:
 * the board is identical for every org member, and a full refresh of ~1,000 issues costs
 * about 40 rate-limit points. Charged to each user's personal 5,000/hour budget that is
 * two open tabs before the app throttles itself and starves everything else they do with
 * GitHub. Charged to the installation, it is one budget the whole team shares, and the
 * cache in `board-cache.ts` keeps the draw on it flat as more people sign in.
 *
 * Writes deliberately stay on the user's token so GitHub attributes them to the person.
 *
 * Falls back to `null` when the App is not configured yet, which is the state this repo
 * is in until an org owner creates it — callers then use the caller's token as before.
 */
import { createSign } from 'node:crypto';
import { env } from '../env';
import { GitHubClient } from './gql';

const REST_URL = 'https://api.github.com';
/** Refresh a little before GitHub expires it, so an in-flight request never fails. */
const EXPIRY_MARGIN_MS = 5 * 60_000;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Env vars carrying a PEM on one line keep literal "\n" escapes; both forms must work. */
export function normalizePrivateKey(key: string): string {
  return key.includes('-----BEGIN') && key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

/** A short-lived App JWT: the credential that can ask for installation tokens. */
export function appJwt(appId: string, privateKey: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60; // tolerate clock skew on GitHub's side
  const payload = { iat, exp: iat + 540, iss: appId };
  const signingInput = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  return `${signingInput}.${base64url(signer.sign(normalizePrivateKey(privateKey)))}`;
}

async function appRequest<T>(jwt: string, method: string, path: string): Promise<T> {
  const res = await fetch(`${REST_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'radius-bugtracker',
    },
  });
  if (!res.ok)
    throw new Error(
      `GitHub App request ${method} ${path} failed: ${res.status} ${await res.text()}`,
    );
  return (await res.json()) as T;
}

let cached: { token: string; expiresAt: number } | undefined;
let inFlight: Promise<string> | undefined;

async function mintInstallationToken(appId: string, privateKey: string): Promise<string> {
  const e = env();
  const jwt = appJwt(appId, privateKey);
  const installation = await appRequest<{ id: number }>(
    jwt,
    'GET',
    `/orgs/${e.GITHUB_ORG}/installation`,
  );
  const res = await fetch(`${REST_URL}/app/installations/${installation.id}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'radius-bugtracker',
    },
  });
  if (!res.ok)
    throw new Error(`Could not mint an installation token: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { token: string; expires_at: string };
  cached = { token: json.token, expiresAt: Date.parse(json.expires_at) };
  return json.token;
}

/** True when the App credentials needed for installation auth are present. */
export function appAuthConfigured(): boolean {
  const e = env();
  return Boolean(e.GITHUB_APP_ID && e.GITHUB_APP_PRIVATE_KEY);
}

/**
 * A client authenticated as the App installation, or `null` when the App is not set up.
 * Concurrent callers share one mint so a cold instance does not stampede GitHub.
 */
export async function installationClient(): Promise<GitHubClient | null> {
  const e = env();
  if (!e.GITHUB_APP_ID || !e.GITHUB_APP_PRIVATE_KEY) return null;
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now())
    return new GitHubClient(cached.token);
  inFlight ??= mintInstallationToken(e.GITHUB_APP_ID, e.GITHUB_APP_PRIVATE_KEY).finally(() => {
    inFlight = undefined;
  });
  return new GitHubClient(await inFlight);
}

/** Test seam. */
export function resetInstallationToken() {
  cached = undefined;
  inFlight = undefined;
}

/**
 * The client to use for *reads*. Prefers the App installation so read volume is charged to
 * one shared budget; falls back to the caller's own token while the App does not exist.
 */
export async function readClient(accessToken: string): Promise<GitHubClient> {
  return (await installationClient()) ?? new GitHubClient(accessToken);
}
