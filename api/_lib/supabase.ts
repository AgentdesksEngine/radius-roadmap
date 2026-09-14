import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, requireSupabaseEnv } from './env.js';

/**
 * Signed in until you sign out. Supabase rotates the refresh token on every use and the
 * project has no session time-box, so the only thing that ends a session is the cookie
 * expiring — left unset it would be a session cookie and die with the browser window.
 * 365 days, under the 400-day ceiling browsers impose on Max-Age.
 */
export const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function parseCookies(header?: string): { name: string; value: string }[] {
  if (!header) return [];
  return header
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf('=');
      if (idx === -1) return { name: pair, value: '' };
      return { name: pair.slice(0, idx), value: decodeURIComponent(pair.slice(idx + 1)) };
    });
}

function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  parts.push(`Max-Age=${options.maxAge ?? SESSION_MAX_AGE_SECONDS}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (env().isProduction || options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Cookie-bound client, scoped to the signed-in user (RLS applies). Used to read/refresh the session. */
export function supabaseForRequest(req: VercelRequest, res: VercelResponse) {
  const e = requireSupabaseEnv();
  return createServerClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, {
    cookieOptions: { maxAge: SESSION_MAX_AGE_SECONDS },
    cookies: {
      getAll: () => parseCookies(req.headers.cookie),
      setAll: (cookies) => {
        const existing = res.getHeader('Set-Cookie');
        const headers = Array.isArray(existing)
          ? existing.map(String)
          : existing
            ? [String(existing)]
            : [];
        for (const { name, value, options } of cookies) {
          headers.push(serializeCookie(name, value, options));
        }
        res.setHeader('Set-Cookie', headers);
      },
    },
  });
}

let admin: SupabaseClient | undefined;

/** Service-role client. Bypasses RLS — only for trusted server-side use (never exposed to the browser). */
export function supabaseAdmin(): SupabaseClient {
  if (!admin) {
    const e = requireSupabaseEnv();
    admin = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return admin;
}
