import { env } from '../_lib/env';
import { route } from '../_lib/http';
import { supabaseForRequest } from '../_lib/supabase';

async function logout(req: Parameters<typeof supabaseForRequest>[0], res: Parameters<typeof supabaseForRequest>[1]) {
  await supabaseForRequest(req, res).auth.signOut();
  if (req.method === 'GET') res.redirect(302, `${env().appUrl}/`);
  else res.status(200).json({ ok: true });
}

export default route({ GET: logout, POST: logout });
