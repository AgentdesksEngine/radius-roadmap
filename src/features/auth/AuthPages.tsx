import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthStatus } from '@shared/types';
import { keys, useAuth } from '@/api/hooks';
import { get, SIGNED_OUT_EVENT } from '@/api/client';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="14" height="14" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.6 18.9 13 24 13c3.1 0 5.9 1.1 8 3l5.7-5.7C34.6 7.1 29.6 5 24 5c-7.8 0-14.5 4.4-17.7 10.9z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-2.1 14.1-5.6l-6.5-5.5C29.5 34.8 26.9 36 24 36c-5.3 0-9.7-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.5 5.5C39.5 37.5 44 31.5 44 24c0-1.3-.1-2.7-.4-3.5z" />
    </svg>
  );
}

function callbackUrl(returnTo: string) {
  return `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`;
}

export function SignInPage() {
  const { data } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const error = params.get('error');
  const returnTo = location.pathname === '/' ? '/board' : location.pathname + location.search;

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null);

  const disabled = data ? !data.oauthConfigured : false;

  const signInWithGoogle = () => {
    void supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl(returnTo) },
    });
  };

  const sendMagicLink = async () => {
    if (!email.trim()) return;
    setSending(true);
    setMagicLinkError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl(returnTo) },
    });
    setSending(false);
    if (err) setMagicLinkError(err.message);
    else setSent(true);
  };

  return (
    <div className="state-page">
      <div className="state-card">
        <Logo />
        <h1>Bugtracker</h1>
        <p>Bugs and feature requests for Radius. Sign in with your @radiusagent.com account.</p>
        {error && (
          <p style={{ color: 'var(--danger)' }} role="alert">
            {error}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <Button variant="primary" icon={<GoogleMark />} onClick={signInWithGoogle} disabled={disabled}>
            Sign in with Google
          </Button>
          {data && !data.oauthConfigured && <span className="faint">Sign-in is not configured yet.</span>}

          {sent ? (
            <p className="faint">Check {email} for a sign-in link.</p>
          ) : (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                className="input"
                type="email"
                placeholder="you@radiusagent.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void sendMagicLink();
                }}
                disabled={disabled}
              />
              <Button variant="ghost" size="sm" onClick={() => void sendMagicLink()} disabled={disabled || sending}>
                {sending ? 'Sending…' : 'Send magic link'}
              </Button>
            </div>
          )}
          {magicLinkError && (
            <span style={{ color: 'var(--danger)' }} className="faint">
              {magicLinkError}
            </span>
          )}

          {data?.devLoginAvailable && (
            <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/api/auth/dev-login')}>
              Developer sign-in (local account)
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function NotMemberPage() {
  const [params] = useSearchParams();
  const email = params.get('email');
  return (
    <div className="state-page">
      <div className="state-card">
        <Logo />
        <h1>Not a Radius Agent account</h1>
        <p>
          {email ? <span className="mono">{email}</span> : 'This account'} is not recognized as a
          @radiusagent.com account. Sign in with your work email, or ask an admin for access.
        </p>
        <Button onClick={() => (window.location.href = '/api/auth/logout')}>Try another account</Button>
      </div>
    </div>
  );
}

/**
 * Route target for both the Google OAuth redirect and the magic-link email. The Supabase
 * client resolves the code/token in the URL as soon as it loads; we then ask the server
 * whether the resulting account is allowed in before routing anywhere.
 */
export function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await supabase.auth.getSession();
      const status = await qc.fetchQuery({ queryKey: keys.auth, queryFn: () => get<AuthStatus>('/api/auth/me') });
      if (cancelled) return;
      qc.setQueryData(keys.auth, status);
      if (status.user) {
        const returnTo = params.get('returnTo');
        navigate(returnTo && returnTo.startsWith('/') ? returnTo : '/board', { replace: true });
      } else {
        const q = status.deniedEmail ? `?email=${encodeURIComponent(status.deniedEmail)}` : '';
        navigate(`/not-a-member${q}`, { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, params, qc]);

  return (
    <div className="state-page">
      <span className="spinner" />
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
