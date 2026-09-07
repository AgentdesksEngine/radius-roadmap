import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getIronSession, type SessionOptions } from 'iron-session';
import type { SessionUser } from '../../shared/types';
import { env } from './env';
import { HttpError } from './http';
import { refreshAccessToken } from './github/oauth';

export interface SessionToken {
  accessToken: string;
  /** epoch ms; undefined when the token does not expire (PAT / dev login) */
  expiresAt?: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
}

export interface SessionData {
  user?: SessionUser;
  token?: SessionToken;
  oauthState?: string;
  returnTo?: string;
}

export function sessionOptions(): SessionOptions {
  const e = env();
  return {
    password: e.SESSION_SECRET,
    cookieName: 'bt_session',
    ttl: 60 * 60 * 24 * 30,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: e.appUrl.startsWith('https://'),
      path: '/',
    },
  };
}

export function getSession(req: VercelRequest, res: VercelResponse) {
  return getIronSession<SessionData>(req, res, sessionOptions());
}

/**
 * Returns a valid access token for the signed-in user, refreshing it when it is
 * about to expire. Throws 401 when there is no session.
 */
export async function requireToken(req: VercelRequest, res: VercelResponse) {
  const session = await getSession(req, res);
  const { user, token } = session;
  if (!user || !token) throw new HttpError(401, 'Not signed in');

  const soon = Date.now() + 60_000;
  if (token.expiresAt && token.expiresAt < soon) {
    if (!token.refreshToken || (token.refreshExpiresAt && token.refreshExpiresAt < Date.now())) {
      session.destroy();
      throw new HttpError(401, 'Session expired, sign in again');
    }
    const refreshed = await refreshAccessToken(token.refreshToken);
    session.token = refreshed;
    await session.save();
  }
  return { session, user, accessToken: session.token!.accessToken };
}
