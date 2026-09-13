/**
 * Google sign-in cannot be exercised end to end here — it leaves the origin. What can be
 * pinned is the thing that silently breaks it: the redirect URL, which must match what is
 * registered in Google Cloud and Supabase, and must be a route the SPA actually serves.
 */
import { describe, expect, it } from 'vitest';
import { googleSignInOptions } from './AuthPages';

describe('googleSignInOptions', () => {
  it('asks Supabase for the Google provider', () => {
    expect(googleSignInOptions('https://radius-roadmap.vercel.app').provider).toBe('google');
  });

  it('comes back to /auth/callback on the same origin', () => {
    expect(googleSignInOptions('https://radius-roadmap.vercel.app').options.redirectTo).toBe(
      'https://radius-roadmap.vercel.app/auth/callback',
    );
    expect(googleSignInOptions('http://localhost:5173').options.redirectTo).toBe(
      'http://localhost:5173/auth/callback',
    );
  });

  it('hints the work domain to Google', () => {
    expect(googleSignInOptions('http://localhost:5173').options.queryParams.hd).toBe('radiusagent.com');
  });
});
