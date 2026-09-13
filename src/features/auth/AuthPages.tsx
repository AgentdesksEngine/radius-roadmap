import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthStatus } from '@shared/types';
import { keys, useAuth } from '@/api/hooks';
import { get, SIGNED_OUT_EVENT } from '@/api/client';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';

/**
 * Two ways in, and both end at the same gate.
 *
 * Google is the primary path — one click for anyone already signed into Google Workspace.
 * The `hd` parameter only *hints* to Google which domain to prefer; it is trivially removable
 * from the URL, so it is not a security control. `profiles.allowed` (set by the
 * `handle_new_user` trigger from the email domain) is the actual gate, checked server-side by
 * requireUser() on every protected route.
 *
 * Email code is the fallback, for anyone whose Google account is not the work one:
 * `signInWithOtp` sends a 6-digit code (the Supabase email templates are customized to show
 * `{{ .Token }}`, not the link) and `verifyOtp` checks what they type back in on this page.
 */

const OAUTH_DOMAIN_HINT = 'radiusagent.com';

/**
 * Split out from the click handler so the redirect target is testable without a browser —
 * a wrong `redirectTo` is invisible until it 404s in production, and the URL has to be
 * registered in both Google Cloud and Supabase.
 */
export function googleSignInOptions(origin: string) {
  return {
    provider: 'google' as const,
    options: {
      queryParams: { hd: OAUTH_DOMAIN_HINT },
      redirectTo: `${origin}/auth/callback`,
    },
  };
}

export function SignInPage() {
  const { data } = useAuth();
  const qc = useQueryClient();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deniedEmail, setDeniedEmail] = useState<string | null>(null);

  const disabled = data ? !data.authConfigured : false;

  const signInWithGoogle = async () => {
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth(googleSignInOptions(window.location.origin));
    if (err) setError(err.message);
  };

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setSending(false);
    if (err) setError(err.message);
    else setStage('code');
  };

  const verifyCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || verifying) return;
    setVerifying(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    if (err) {
      setVerifying(false);
      setError(err.message);
      return;
    }
    const status = await qc.fetchQuery({ queryKey: keys.auth, queryFn: () => get<AuthStatus>('/api/auth/me') });
    qc.setQueryData(keys.auth, status);
    setVerifying(false);
    if (!status.user) setDeniedEmail(status.deniedEmail ?? email.trim());
  };

  if (deniedEmail) return <NotMemberPage email={deniedEmail} />;

  return (
    <div className="state-page">
      <div className="state-card">
        <Logo />
        <h1>Bugtracker</h1>
        <p>Bugs and feature requests for Radius. Sign in with your @radiusagent.com account.</p>
        {data && !data.authConfigured && <span className="faint">Sign-in is not configured yet.</span>}

        <Button variant="primary" disabled={disabled} onClick={() => void signInWithGoogle()} style={{ width: '100%' }}>
          <GoogleMark /> Continue with Google
        </Button>

        <div className="auth-sep">
          <span>or</span>
        </div>

        {stage === 'email' ? (
          <form
            onSubmit={(e) => void sendCode(e)}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}
          >
            <input
              className="input"
              type="email"
              placeholder="you@radiusagent.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={disabled}
              autoFocus
            />
            <Button type="submit" disabled={disabled || sending}>
              {sending ? 'Sending…' : 'Sign in with email code'}
            </Button>
          </form>
        ) : (
          <form
            onSubmit={(e) => void verifyCode(e)}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}
          >
            <p className="faint">Enter the code sent to {email}.</p>
            <input
              className="input mono"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            <Button type="submit" disabled={verifying}>
              {verifying ? 'Verifying…' : 'Verify code'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setStage('email');
                setCode('');
                setError(null);
              }}
            >
              Use a different email
            </Button>
          </form>
        )}

        {error && (
          <p style={{ color: 'var(--danger)' }} role="alert">
            {error}
          </p>
        )}

        {data?.devLoginAvailable && (
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = '/api/auth/dev-login')}>
            Developer sign-in (local account)
          </Button>
        )}
      </div>
    </div>
  );
}

/** Google's four-colour G, inlined so the button does not depend on a remote asset. */
function GoogleMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8a10 10 0 0 1-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.3z" />
      <path fill="#34A853" d="M24 46c6 0 11-2 14.5-5.2l-7.1-5.5a13.3 13.3 0 0 1-19.8-7h-7.3v5.7A22 22 0 0 0 24 46z" />
      <path fill="#FBBC05" d="M11.6 28.3a13.2 13.2 0 0 1 0-8.6v-5.7H4.3a22 22 0 0 0 0 20l7.3-5.7z" />
      <path fill="#EA4335" d="M24 9.5c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3A21.9 21.9 0 0 0 4.3 14l7.3 5.7A13.1 13.1 0 0 1 24 9.5z" />
    </svg>
  );
}

/**
 * Where Google sends people back to. The Supabase browser client reads the session out of the
 * URL on load, so this page only has to wait for that to settle and then get out of the way.
 */
export function AuthCallbackPage() {
  const [state, setState] = useState<'waiting' | 'done' | 'denied'>('waiting');
  const [deniedEmail, setDeniedEmail] = useState<string | undefined>();
  const qc = useQueryClient();

  useEffect(() => {
    let settled = false;

    const finish = async () => {
      if (settled) return;
      settled = true;
      const status = await qc.fetchQuery({ queryKey: keys.auth, queryFn: () => get<AuthStatus>('/api/auth/me') });
      qc.setQueryData(keys.auth, status);
      if (status.user) setState('done');
      else {
        setDeniedEmail(status.deniedEmail);
        setState('denied');
      }
    };

    // The browser client exchanges the code in the URL for a session on load, which may not
    // have finished by the time this mounts — so listen as well as look, and take whichever
    // arrives first. Google denials come back as ?error= with no session at all.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void finish();
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void finish();
    });

    const giveUp = setTimeout(() => {
      if (!settled) {
        settled = true;
        setState('denied');
      }
    }, 10_000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(giveUp);
    };
  }, [qc]);

  if (state === 'done') return <Navigate to="/home" replace />;
  if (state === 'denied') return <NotMemberPage email={deniedEmail} />;
  return (
    <div className="state-page">
      <span className="spinner" />
    </div>
  );
}

export function NotMemberPage({ email }: { email?: string } = {}) {
  const [params] = useSearchParams();
  const shownEmail = email ?? params.get('email') ?? undefined;
  return (
    <div className="state-page">
      <div className="state-card">
        <Logo />
        <h1>Not a Radius Agent account</h1>
        <p>
          {shownEmail ? <span className="mono">{shownEmail}</span> : 'This account'} is not recognized as a
          @radiusagent.com account. Sign in with your work email, or ask an admin for access.
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
