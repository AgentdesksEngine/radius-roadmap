import { z } from 'zod';

/**
 * Superset of the Supabase-era vars the live API needs and the GitHub-era vars the
 * one-off migration tooling (scripts/migrate-github-to-supabase.ts and its
 * dump-schema/provision-fields/_lib.ts helpers) still needs to read the old board during
 * the cutover. That migration-only block goes away in Phase 4 of the cutover plan, once the
 * migration is done and api/_lib/github/{app,board,gql}.ts is deleted for good.
 *
 * GITHUB_WEBHOOK_SECRET and GITHUB_ORG are NOT part of that block: they are live again, used
 * by the PR webhook, and outlive the migration.
 */
const schema = z.object({
  // --- Supabase (live API) ---
  DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  ALLOWED_EMAIL_DOMAIN: z.string().default('radiusagent.com'),
  DEV_LOGIN_EMAIL: z.string().optional(),
  DEV_LOGIN_PASSWORD: z.string().optional(),

  // --- GitHub PR webhook (live: api/github/[action].ts) ---
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  /** Only PRs from repos owned by this org are acted on. */
  GITHUB_ORG: z.string().default('AgentdesksEngine'),

  // --- GitHub (migration tooling only; unused by the live API) ---
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_PROJECT_NUMBER: z.coerce.number().int().positive().default(6),
  GITHUB_ISSUES_REPO: z.string().default('radius-roadmap'),
  DEV_GITHUB_TOKEN: z.string().optional(),

  // --- Slack ingest (api/slack/[action].ts) ---
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  /** The app's own user id, so it can ignore its own thread replies instead of looping. */
  SLACK_BOT_USER_ID: z.string().optional(),
  /** Reaction that captures a bug, without the colons. */
  SLACK_TRIGGER_EMOJI: z.string().default('bug'),
  /** Comma-separated channel-id allowlist. Empty means "any channel the app is in". */
  SLACK_INGEST_CHANNELS: z.string().optional(),

  // --- Shared ---
  ISSUE_KEY_PREFIX: z.string().default('RAD'),
  APP_URL: z.string().optional(),
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
  VERCEL_URL: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

export type Env = z.infer<typeof schema> & { appUrl: string; isProduction: boolean };

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;
  const appUrl =
    e.APP_URL ?? (e.VERCEL_URL ? `https://${e.VERCEL_URL}` : 'http://localhost:5173');
  cached = { ...e, appUrl: appUrl.replace(/\/$/, ''), isProduction: e.VERCEL_ENV === 'production' };
  return cached;
}

/** Live API routes call this to fail fast with a clear error instead of a null DATABASE_URL crash. */
export function requireSupabaseEnv() {
  const e = env();
  if (!e.DATABASE_URL || !e.SUPABASE_URL || !e.SUPABASE_ANON_KEY || !e.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'DATABASE_URL / SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are not all set. See .env.example.',
    );
  }
  return e as Env & {
    DATABASE_URL: string;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
  };
}

/**
 * The Slack route calls this before touching a request. Failing loudly here beats the
 * alternative — an unconfigured signing secret would otherwise mean every request verifies
 * against `undefined`, and the endpoint silently accepts nothing.
 */
export function requireSlackEnv() {
  const e = env();
  if (!e.SLACK_SIGNING_SECRET || !e.SLACK_BOT_TOKEN) {
    throw new Error('SLACK_SIGNING_SECRET / SLACK_BOT_TOKEN are not set. See .env.example.');
  }
  return e as Env & { SLACK_SIGNING_SECRET: string; SLACK_BOT_TOKEN: string };
}

/** Same reasoning as requireSlackEnv: an unset secret must fail loudly, not verify as empty. */
export function requireGithubEnv() {
  const e = env();
  if (!e.GITHUB_WEBHOOK_SECRET) {
    throw new Error('GITHUB_WEBHOOK_SECRET is not set. See .env.example.');
  }
  return e as Env & { GITHUB_WEBHOOK_SECRET: string };
}

/** Channel allowlist, parsed. An empty set means "no restriction". */
export function slackIngestChannels(): Set<string> {
  return new Set(
    (env().SLACK_INGEST_CHANNELS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
