import { env } from '../_lib/env';
import { route } from '../_lib/http';
import { getSession } from '../_lib/session';

async function logout(req: Parameters<typeof getSession>[0], res: Parameters<typeof getSession>[1]) {
  const session = await getSession(req, res);
  session.destroy();
  if (req.method === 'GET') res.redirect(302, `${env().appUrl}/`);
  else res.status(200).json({ ok: true });
}

export default route({ GET: logout, POST: logout });
