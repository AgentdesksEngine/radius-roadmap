import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthStatus } from '@shared/types';
import { keys, useAuth } from '@/api/hooks';
import { get, SIGNED_OUT_EVENT } from '@/api/client';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';

/**
 * Sign-in is a single form that walks email -> code: `signInWithOtp` sends a 6-digit code
 * (the Supabase "Magic Link" email template is customized to show `{{ .Token }}`, not the
 * link), and `verifyOtp` checks the code the user types back in on this same page. No
 * password to store or reset, and no redirect/callback route needed.
 */
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
            <Button type="submit" variant="primary" disabled={disabled || sending}>
              {sending ? 'Sending…' : 'Send code'}
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
            <Button type="submit" variant="primary" disabled={verifying}>
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
