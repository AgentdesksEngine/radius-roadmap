import { z } from 'zod';

const schema = z.object({
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  /** Shared secret configured on the App's webhook. Without it the webhook route refuses everything. */
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_ORG: z.string().default('AgentdesksEngine'),
  GITHUB_PROJECT_NUMBER: z.coerce.number().int().positive().default(6),
  GITHUB_ISSUES_REPO: z.string().default('radius-roadmap'),
  ISSUE_KEY_PREFIX: z.string().default('RAD'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  APP_URL: z.string().optional(),
  DEV_GITHUB_TOKEN: z.string().optional(),
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

export function requireOAuthEnv() {
  const e = env();
  if (!e.GITHUB_APP_CLIENT_ID || !e.GITHUB_APP_CLIENT_SECRET) {
    throw new Error(
      'GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET are not set. Create the GitHub App (see README) or use /api/auth/dev-login locally.',
    );
  }
  return { clientId: e.GITHUB_APP_CLIENT_ID, clientSecret: e.GITHUB_APP_CLIENT_SECRET };
}
