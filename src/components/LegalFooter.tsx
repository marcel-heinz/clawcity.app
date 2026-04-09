'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CookieBanner } from '@/components/CookieBanner';

export function LegalFooter() {
  const [showCookieSettings, setShowCookieSettings] = useState(false);

  return (
    <>
      <footer className="border-t-2 border-[var(--border)] py-8">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 text-sm">
          <Link
            href="/terms"
            className="text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
          >
            Terms
          </Link>
          <Link
            href="/privacy"
            className="text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
          >
            Privacy
          </Link>
          <Link
            href="/imprint"
            className="text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
          >
            Imprint
          </Link>
          <button
            type="button"
            onClick={() => setShowCookieSettings(true)}
            className="text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
          >
            Cookie Settings
          </button>
        </div>
      </footer>

      <CookieBanner
        isSettingsOpen={showCookieSettings}
        onCloseSettings={() => setShowCookieSettings(false)}
      />
    </>
  );
}
