import { useEffect, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { keys, useAuth } from '@/api/hooks';
import { SIGNED_OUT_EVENT } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function SignInPage() {
  const { data } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const error = params.get('error');
  const returnTo = encodeURIComponent(location.pathname === '/' ? '/board' : location.pathname + location.search);
  return (
    <div className="state-page">
      <div className="state-card">
        <Logo />
        <h1>Bugtracker</h1>
        <p>Bugs and feature requests for Radius, backed by GitHub Projects. Sign in with a GitHub account that belongs to the AgentdesksEngine org.</p>
        {error && (
          <p style={{ color: 'var(--danger)' }} role="alert">
            {error}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <Button variant="primary" icon={<GitHubMark />} onClick={() => (window.location.href = `/api/auth/login?returnTo=${returnTo}`)} disabled={data ? !data.oauthConfigured : false}>
            Sign in with GitHub
          </Button>
          {data && !data.oauthConfigured && <span className="faint">GitHub App credentials are not configured yet.</span>}
          {data?.devLoginAvailable && (
            <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/api/auth/dev-login')}>
              Developer sign-in (local token)
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function NotMemberPage() {
  const [params] = useSearchParams();
  const login = params.get('login');
  return (
    <div className="state-page">
      <div className="state-card">
        <Logo />
        <h1>Not part of this org</h1>
        <p>
          {login ? <span className="mono">@{login}</span> : 'This account'} is not a member of the AgentdesksEngine GitHub organization. Ask an org owner for an invite, then sign in again.
        </p>
        <Button onClick={() => (window.location.href = '/api/auth/logout')}>Try another account</Button>
      </div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending, isError, refetch } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    const onSignedOut = () => qc.setQueryData(keys.auth, (a: { user: unknown } | undefined) => (a ? { ...a, user: null } : a));
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [qc]);

  if (isPending) {
    return (
      <div className="state-page">
        <span className="spinner" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="state-page">
        <div className="state-card">
          <h1>Can’t reach the server</h1>
          <p>The API did not respond. Check your connection and try again.</p>
          <Button onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }
  if (!data?.user) return <SignInPage />;
  return <>{children}</>;
}
