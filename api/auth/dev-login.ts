/**
 * Local-development sign-in against one fixed seeded Supabase account (email/password
 * provider enabled only for that one account), so local dev doesn't need real magic-link
 * email delivery. Disabled in production and when unset.
 */
import { env } from '../_lib/env';
import { HttpError, route } from '../_lib/http';
import { supabaseForRequest } from '../_lib/supabase';

export default route({
  GET: async (req, res) => {
    const e = env();
    if (e.isProduction || !e.DEV_LOGIN_EMAIL || !e.DEV_LOGIN_PASSWORD) throw new HttpError(404, 'Not found');
    const supabase = supabaseForRequest(req, res);
    const { error } = await supabase.auth.signInWithPassword({
      email: e.DEV_LOGIN_EMAIL,
      password: e.DEV_LOGIN_PASSWORD,
    });
    if (error) throw new HttpError(401, error.message);
    res.redirect(302, `${e.appUrl}/`);
  },
});
