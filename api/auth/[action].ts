import { randomBytes } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { AuthStatus } from '../../shared/types.js';
import { env } from '../_lib/env.js';
import { HttpError, noStore, param, route } from '../_lib/http.js';
import { getSession } from '../_lib/session.js';
import { authorizeUrl, exchangeCode, fetchViewer } from '../_lib/github/oauth.js';

/**
 * All of /api/auth/* in one function — a single dynamic segment (:action) rather than
 * five separate files, to stay under the Hobby plan's per-deployment function cap.
 */

async function login(req: VercelRequest, res: VercelResponse) {
  const session = await getSession(req, res);
  const state = randomBytes(16).toString('hex');
  const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.startsWith('/') ? req.query.returnTo : '/';
  session.oauthState = state;
  session.returnTo = returnTo;
  await session.save();
  res.redirect(302, authorizeUrl(state));
}

async function callback(req: VercelRequest, res: VercelResponse) {
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
}

/**
 * Local-development sign-in that uses DEV_GITHUB_TOKEN (a personal token) instead of the
 * GitHub App OAuth flow. Disabled in production and when the variable is unset.
 */
async function devLogin(req: VercelRequest, res: VercelResponse) {
  const e = env();
  if (e.isProduction || !e.DEV_GITHUB_TOKEN) throw new HttpError(404, 'Not found');
  const viewer = await fetchViewer(e.DEV_GITHUB_TOKEN);
  if (!viewer.isOrgMember) throw new HttpError(403, `${viewer.login} is not a member of ${e.GITHUB_ORG}`);
  const session = await getSession(req, res);
  session.user = { login: viewer.login, avatarUrl: viewer.avatarUrl, name: viewer.name };
  session.token = { accessToken: e.DEV_GITHUB_TOKEN };
  await session.save();
  res.redirect(302, `${e.appUrl}/`);
}

async function logout(req: VercelRequest, res: VercelResponse) {
  const session = await getSession(req, res);
  session.destroy();
  if (req.method === 'GET') res.redirect(302, `${env().appUrl}/`);
  else res.status(200).json({ ok: true });
}

async function me(req: VercelRequest, res: VercelResponse) {
  const e = env();
  const session = await getSession(req, res);
  noStore(res);
  const body: AuthStatus = {
    user: session.user ?? null,
    oauthConfigured: Boolean(e.GITHUB_APP_CLIENT_ID && e.GITHUB_APP_CLIENT_SECRET),
    devLoginAvailable: Boolean(e.DEV_GITHUB_TOKEN) && !e.isProduction,
  };
  res.status(200).json(body);
}

const GET_ACTIONS: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void>> = {
  login,
  callback,
  'dev-login': devLogin,
  logout,
  me,
};

export default route({
  GET: async (req, res) => {
    const handler = GET_ACTIONS[param(req, 'action')];
    if (!handler) throw new HttpError(404, 'Not found');
    await handler(req, res);
  },
  POST: async (req, res) => {
    if (param(req, 'action') !== 'logout') throw new HttpError(404, 'Not found');
    await logout(req, res);
  },
});
