import type { AuthStatus } from '../../shared/types';
import { env } from '../_lib/env';
import { noStore, route } from '../_lib/http';
import { getSession } from '../_lib/session';

export default route({
  GET: async (req, res) => {
    const e = env();
    const session = await getSession(req, res);
    noStore(res);
    const body: AuthStatus = {
      user: session.user ?? null,
      oauthConfigured: Boolean(e.GITHUB_APP_CLIENT_ID && e.GITHUB_APP_CLIENT_SECRET),
      devLoginAvailable: Boolean(e.DEV_GITHUB_TOKEN) && !e.isProduction,
    };
    res.status(200).json(body);
  },
});
