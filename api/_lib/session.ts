import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SessionUser } from '../../shared/types.js';
import { HttpError } from './http.js';
import { supabaseAdmin, supabaseForRequest } from './supabase.js';

interface ProfileRow {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  allowed: boolean;
}

export function toSessionUser(profile: ProfileRow): SessionUser {
  return { id: profile.id, email: profile.email, name: profile.display_name, avatarUrl: profile.avatar_url };
}

export interface Authed {
  user: SessionUser;
  profileId: string;
}

/**
 * Verifies the Supabase session cookie and that the account is `allowed`. Throws 401 when
 * there is no session, 403 when there is a session but the account isn't allowed in (and
 * signs it out server-side so it doesn't sit half-authenticated).
 */
export async function requireUser(req: VercelRequest, res: VercelResponse): Promise<Authed> {
  const supabase = supabaseForRequest(req, res);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new HttpError(401, 'Not signed in');

  const { data: profile } = await supabaseAdmin()
    .from('profiles')
    .select('id, email, display_name, avatar_url, allowed')
    .eq('auth_user_id', user.id)
    .single<ProfileRow>();

  if (!profile?.allowed) {
    await supabase.auth.signOut();
    throw new HttpError(403, 'Not an allowed account');
  }

  return { user: toSessionUser(profile), profileId: profile.id };
}
