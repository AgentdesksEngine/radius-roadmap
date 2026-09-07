// Shared helpers for one-off scripts. Scripts run locally with a personal token,
// never with the App credentials.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { GitHubClient } from '../api/_lib/github/gql';

/** Minimal .env loader so scripts work without extra deps. Does not override existing vars. */
export function loadDotenv(path = '.env') {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

export function scriptToken(): string {
  loadDotenv();
  const fromEnv = process.env.GITHUB_TOKEN ?? process.env.DEV_GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('No GITHUB_TOKEN in env and `gh auth token` failed. Run `gh auth login`.');
  }
}

export function scriptClient() {
  // Scripts do not need a session secret, but env() validates one. Provide a throwaway.
  process.env.SESSION_SECRET ??= 'script-only-session-secret-not-used-anywhere';
  return new GitHubClient(scriptToken());
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
