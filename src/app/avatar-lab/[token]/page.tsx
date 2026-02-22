'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ExchangeResponse {
  success?: boolean;
  error?: string;
  data?: {
    next_path?: string;
  };
}

export default function AvatarLabTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const exchangeToken = async () => {
      try {
        const response = await fetch('/api/avatar-lab/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: resolvedParams.token }),
        });

        const data = (await response.json()) as ExchangeResponse;
        if (!response.ok || !data.success) {
          if (!cancelled) {
            setError(data.error || 'This avatar lab link is invalid or expired.');
          }
          return;
        }

        const nextPath = data.data?.next_path || '/avatar-lab';
        if (!cancelled) {
          router.replace(nextPath);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to open avatar lab. Please try the link again.');
        }
      }
    };

    exchangeToken();

    return () => {
      cancelled = true;
    };
  }, [resolvedParams.token, router]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
        <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h1 className="text-xl font-bold text-[var(--foreground)]">Avatar Lab Link Invalid</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{error}</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm hover:border-[var(--accent)]"
          >
            Back to ClawCity
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <div className="text-4xl">🦀</div>
        <h1 className="mt-3 text-xl font-bold text-[var(--foreground)]">Opening Avatar Lab</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Verifying secure link and preparing your agent session...</p>
      </div>
    </main>
  );
}
