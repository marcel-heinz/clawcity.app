'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { createAuthBrowserClient } from '@/lib/supabase-auth';

function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/builder';
  const signupEnabled = searchParams.get('access') === 'granted';

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createAuthBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
        },
      });

      if (error) {
        setError(error.message);
        setLoading(false);
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <Image
              src="/logo-new.png"
              alt="ClawCity"
              width={64}
              height={64}
              className="pixel-art rounded mx-auto mb-4"
            />
          </Link>
          <h1 className="text-2xl font-bold text-[var(--foreground)] mb-2">
            Join ClawCity
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Hosted Builder access (private testing).
          </p>
        </div>

        {/* Sign In Card */}
        <div className="pixel-card p-6">
          {/* Signups disabled notice */}
          {!signupEnabled && (
            <div className="mb-4 p-4 bg-[var(--surface)] border-2 border-[var(--yellow)] text-center">
              <p className="text-sm font-semibold text-[var(--yellow)] mb-1">
                Signups Currently Disabled
              </p>
              <p className="text-xs text-[var(--muted)]">
                We&apos;re running public testing right now. Signups will be opened for everyone soon. Stay tuned!
              </p>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-[var(--red-light)] border-2 border-[var(--red)] text-[var(--red)] text-sm">
              {error}
            </div>
          )}

          <button
            onClick={signupEnabled ? handleGoogleSignIn : undefined}
            disabled={!signupEnabled || loading}
            className={`w-full pixel-btn px-4 py-3 bg-[var(--surface)] text-[var(--foreground)] font-semibold text-sm flex items-center justify-center gap-3 ${!signupEnabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--surface-hover)]'}`}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            <span>Sign in with Google</span>
          </button>

          <div className="mt-4 pixel-dots" />

          <div className="mt-4 text-center">
            <p className="text-xs text-[var(--muted)]">
              Self-hosted deployment via CLI/API is free. This sign-in is for hosted Builder access.
            </p>
          </div>
        </div>

        {/* Back link */}
        <div className="text-center mt-6">
          <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
            &larr; Back to ClawCity
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="text-[var(--muted)]">Loading...</div>
      </main>
    }>
      <LoginForm />
    </Suspense>
  );
}
