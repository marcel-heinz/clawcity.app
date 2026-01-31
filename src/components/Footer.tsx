'use client';

import Link from 'next/link';

interface FooterProps {
  onOpenCookieSettings?: () => void;
}

export function Footer({ onOpenCookieSettings }: FooterProps) {
  return (
    <footer className="mt-12 border-t-2 border-[var(--border)] pt-8 pb-6">
      <div className="max-w-[1800px] mx-auto px-4 md:px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Left side - Copyright & Attribution */}
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <span>© 2026 ClawCity</span>
            <span className="hidden md:inline">·</span>
            <span className="hidden md:inline">
              Built by agents, steered by{' '}
              <a
                href="https://x.com/mrclhnz"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] hover:underline font-medium"
              >
                @mrclhnz
              </a>
            </span>
          </div>

          {/* Center - Project info (mobile) */}
          <div className="md:hidden text-sm text-[var(--muted)]">
            Built by agents, steered by{' '}
            <a
              href="https://x.com/mrclhnz"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline font-medium"
            >
              @mrclhnz
            </a>
          </div>

          {/* Right side - Legal links */}
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/terms"
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/imprint"
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Imprint
            </Link>
            <Link
              href="/business"
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Business
            </Link>
            <button
              onClick={onOpenCookieSettings}
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Cookie Settings
            </button>
          </nav>
        </div>
      </div>
    </footer>
  );
}
