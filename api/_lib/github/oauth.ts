import { env, requireOAuthEnv } from '../env.js';
import { HttpError } from '../http.js';
import type { SessionToken } from '../session.js';
import { GitHubClient } from './gql.js';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

export function callbackUrl() {
  return `${env().appUrl}/api/auth/callback`;
}

export function authorizeUrl(state: string) {
  const { clientId } = requireOAuthEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl(),
    state,
    // GitHub Apps ignore `scope`; permissions come from the App configuration.
  });
  return `${AUTHORIZE_URL}?${params}`;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<SessionToken> {
  const { clientId, clientSecret } = requireOAuthEnv();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...params }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error || !json.access_token) {
    throw new HttpError(401, json.error_description ?? json.error ?? 'Token exchange failed');
  }
  const now = Date.now();
  return {
    accessToken: json.access_token,
    expiresAt: json.expires_in ? now + json.expires_in * 1000 : undefined,
    refreshToken: json.refresh_token,
    refreshExpiresAt: json.refresh_token_expires_in ? now + json.refresh_token_expires_in * 1000 : undefined,
  };
}

export function exchangeCode(code: string) {
  return tokenRequest({ code, redirect_uri: callbackUrl() });
}

export function refreshAccessToken(refreshToken: string) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

export interface ViewerInfo {
  login: string;
  avatarUrl: string;
  name: string | null;
  isOrgMember: boolean;
}

/** Who is this token, and are they in our org? */
export async function fetchViewer(accessToken: string): Promise<ViewerInfo> {
  const gh = new GitHubClient(accessToken);
  const org = env().GITHUB_ORG;
  const data = await gh.graphql<{
    viewer: { login: string; avatarUrl: string; name: string | null };
    organization: { viewerIsAMember: boolean } | null;
  }>(
    `query Viewer($org: String!) {
       viewer { login avatarUrl name }
       organization(login: $org) { viewerIsAMember }
     }`,
    { org },
  );
  let isOrgMember = data.organization?.viewerIsAMember ?? false;
  if (!isOrgMember) {
    // Fallback: the membership endpoint sees private memberships the GraphQL field may hide.
    const m = await gh.rest<{ state?: string }>('GET', `/user/memberships/orgs/${org}`);
    isOrgMember = m.status === 200 && m.data?.state === 'active';
  }
  return { login: data.viewer.login, avatarUrl: data.viewer.avatarUrl, name: data.viewer.name, isOrgMember };
}
