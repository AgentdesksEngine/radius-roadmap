import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client. Used for two things only: driving the sign-in UI (email +
 * one-time code) and the Realtime subscription in src/api/realtime.ts. All actual board
 * reads/writes still go through /api/* — this client never talks to Postgres directly.
 *
 * Falls back to a placeholder URL/key when the env vars aren't set, rather than throwing at
 * import time (which would blank-screen the whole app before React even renders) — sign-in
 * and Realtime just fail with a network error instead, and `/api/auth/me` already 500s with a
 * clear "not configured" message that RequireAuth surfaces.
 */
export const supabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
);

if (!supabaseConfigured) {
  console.warn('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — sign-in and Realtime will not work.');
}

export const supabase = createBrowserClient(
  import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key',
);
