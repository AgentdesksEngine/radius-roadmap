import { env } from '../_lib/env';
import { HttpError, route } from '../_lib/http';
import { getSession } from '../_lib/session';
import { exchangeCode, fetchViewer } from '../_lib/github/oauth';

export default route({
  GET: async (req, res) => {
    const { appUrl } = env();
    const q = (k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined);

    if (q('error')) {
      res.redirect(302, `${appUrl}/?error=${encodeURIComponent(q('error_description') ?? q('error')!)}`);
      return;
    }
    const code = q('code');
    const state = q('state');
    const session = await getSession(req, res);
    if (!code || !state || state !== session.oauthState) {
      throw new HttpError(400, 'Invalid OAuth state. Start the sign-in again.');
    }
    const returnTo = session.returnTo ?? '/';

    const token = await exchangeCode(code);
    const viewer = await fetchViewer(token.accessToken);
    if (!viewer.isOrgMember) {
      session.destroy();
      res.redirect(302, `${appUrl}/not-a-member?login=${encodeURIComponent(viewer.login)}`);
      return;
    }

    session.user = { login: viewer.login, avatarUrl: viewer.avatarUrl, name: viewer.name };
    session.token = token;
    delete session.oauthState;
    delete session.returnTo;
    await session.save();
    res.redirect(302, `${appUrl}${returnTo}`);
  },
});
