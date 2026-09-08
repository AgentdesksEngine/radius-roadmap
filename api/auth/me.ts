import type { AuthStatus } from '../../shared/types';
import { env } from '../_lib/env';
import { noStore, route } from '../_lib/http';
import { toSessionUser } from '../_lib/session';
import { supabaseAdmin, supabaseForRequest } from '../_lib/supabase';

export default route({
  GET: async (req, res) => {
    const e = env();
    noStore(res);

    const base = {
      oauthConfigured: Boolean(e.SUPABASE_URL && e.SUPABASE_ANON_KEY),
      devLoginAvailable: Boolean(e.DEV_LOGIN_EMAIL && e.DEV_LOGIN_PASSWORD) && !e.isProduction,
    };

    const supabase = supabaseForRequest(req, res);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      res.status(200).json({ user: null, ...base } satisfies AuthStatus);
      return;
    }

    const { data: profile } = await supabaseAdmin()
      .from('profiles')
      .select('id, email, display_name, avatar_url, allowed')
      .eq('auth_user_id', user.id)
      .single();

    if (!profile?.allowed) {
      // A real Supabase session exists but the account isn't allowed in — sign it out
      // server-side rather than leaving it half-authenticated.
      await supabase.auth.signOut();
      res.status(200).json({ user: null, deniedEmail: user.email ?? undefined, ...base } satisfies AuthStatus);
      return;
    }

    res.status(200).json({ user: toSessionUser(profile), ...base } satisfies AuthStatus);
  },
});
