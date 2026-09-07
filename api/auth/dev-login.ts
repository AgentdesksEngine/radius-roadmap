/**
 * Local-development sign-in that uses DEV_GITHUB_TOKEN (a personal token) instead of the
 * GitHub App OAuth flow. Disabled in production and when the variable is unset.
 */
import { env } from '../_lib/env';
import { HttpError, route } from '../_lib/http';
import { getSession } from '../_lib/session';
import { fetchViewer } from '../_lib/github/oauth';

export default route({
  GET: async (req, res) => {
    const e = env();
    if (e.isProduction || !e.DEV_GITHUB_TOKEN) throw new HttpError(404, 'Not found');
    const viewer = await fetchViewer(e.DEV_GITHUB_TOKEN);
    if (!viewer.isOrgMember) throw new HttpError(403, `${viewer.login} is not a member of ${e.GITHUB_ORG}`);
    const session = await getSession(req, res);
    session.user = { login: viewer.login, avatarUrl: viewer.avatarUrl, name: viewer.name };
    session.token = { accessToken: e.DEV_GITHUB_TOKEN };
    await session.save();
    res.redirect(302, `${e.appUrl}/`);
  },
});
