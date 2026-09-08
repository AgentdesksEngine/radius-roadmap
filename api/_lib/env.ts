import { z } from 'zod';

/**
 * Superset of the Supabase-era vars the live API needs and the GitHub-era vars the
 * one-off migration tooling (scripts/migrate-github-to-supabase.ts and its
 * dump-schema/provision-fields/_lib.ts helpers) still needs to read the old board during
 * the cutover. The GITHUB_* block goes away in Phase 4 of the cutover plan, once the
 * migration is done and api/_lib/github/* is deleted for good.
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

  // --- GitHub (migration tooling only; unused by the live API) ---
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_ORG: z.string().default('AgentdesksEngine'),
  GITHUB_PROJECT_NUMBER: z.coerce.number().int().positive().default(6),
  GITHUB_ISSUES_REPO: z.string().default('radius-roadmap'),
  DEV_GITHUB_TOKEN: z.string().optional(),

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
