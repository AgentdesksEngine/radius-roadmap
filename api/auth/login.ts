import { randomBytes } from 'node:crypto';
import { route } from '../_lib/http';
import { getSession } from '../_lib/session';
import { authorizeUrl } from '../_lib/github/oauth';

export default route({
  GET: async (req, res) => {
    const session = await getSession(req, res);
    const state = randomBytes(16).toString('hex');
    const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.startsWith('/') ? req.query.returnTo : '/';
    session.oauthState = state;
    session.returnTo = returnTo;
    await session.save();
    res.redirect(302, authorizeUrl(state));
  },
});
