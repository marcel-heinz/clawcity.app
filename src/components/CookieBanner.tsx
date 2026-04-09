'use client';

import { useState, useEffect, useCallback } from 'react';
import { ARCHIVE_MODE } from '@/lib/archive-mode';

const COOKIE_CONSENT_KEY = 'clawcity-cookie-consent';

export type CookieConsent = 'accepted' | 'declined' | null;

interface CookieBannerProps {
  isSettingsOpen?: boolean;
  onCloseSettings?: () => void;
}

export function CookieBanner({ isSettingsOpen, onCloseSettings }: CookieBannerProps) {
  const [consent, setConsent] = useState<CookieConsent>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Check for existing consent on mount
  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (stored === 'accepted' || stored === 'declined') {
      setConsent(stored);
    } else {
      setShowBanner(true);
    }
  }, []);

  const handleAccept = useCallback(() => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'accepted');
    setConsent('accepted');
    setShowBanner(false);
    onCloseSettings?.();
  }, [onCloseSettings]);

  const handleDecline = useCallback(() => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'declined');
    setConsent('declined');
    setShowBanner(false);
    onCloseSettings?.();
  }, [onCloseSettings]);

  // Don't render on server
  if (!mounted) return null;

  // Settings modal
  if (isSettingsOpen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="pixel-card p-6 max-w-md mx-4 shadow-xl">
          <h2 className="text-lg font-bold mb-4 text-[var(--foreground)]">
            🍪 Cookie Settings
          </h2>
          
          <p className="text-sm text-[var(--muted)] mb-4">
            {ARCHIVE_MODE
              ? 'We use essential cookies to remember your consent preference and keep the archived site working properly. Analytics remain optional.'
              : 'We use essential cookies to keep you logged in and ensure the site functions properly. We also use analytics to improve ClawCity.'}
          </p>

          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between p-3 bg-[var(--surface-alt)] border-2 border-[var(--border)]">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Essential Cookies</p>
                <p className="text-xs text-[var(--muted)]">
                  {ARCHIVE_MODE ? 'Required to remember your site preferences' : 'Required for basic functionality'}
                </p>
              </div>
              <span className="text-xs text-[var(--accent)] font-medium">Always on</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-[var(--surface-alt)] border-2 border-[var(--border)]">
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">Analytics</p>
                <p className="text-xs text-[var(--muted)]">Helps us improve the experience</p>
              </div>
              <span className="text-xs text-[var(--muted)]">
                {consent === 'accepted' ? '✓ Enabled' : '✗ Disabled'}
              </span>
            </div>
          </div>

          <p className="text-xs text-[var(--muted)] mb-4">
            Current preference:{' '}
            <span className={consent === 'accepted' ? 'text-[var(--accent)] font-medium' : 'text-[var(--gold)] font-medium'}>
              {consent === 'accepted' ? 'Accepted' : consent === 'declined' ? 'Declined' : 'Not set'}
            </span>
          </p>

          <div className="flex gap-3">
            <button
              onClick={handleDecline}
              className="flex-1 px-4 py-2 text-sm border-2 border-[var(--border)] hover:border-[var(--muted)] transition-colors"
            >
              Decline
            </button>
            <button
              onClick={handleAccept}
              className="flex-1 px-4 py-2 text-sm bg-[var(--accent)] text-white font-semibold hover:opacity-90 transition-opacity"
            >
              Accept All
            </button>
          </div>

          <button
            onClick={onCloseSettings}
            className="mt-4 w-full text-center text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            Close without changing
          </button>
        </div>
      </div>
    );
  }

  // Initial consent banner
  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4">
      <div className="max-w-2xl mx-auto pixel-card p-4 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-1">
            <p className="text-sm text-[var(--foreground)]">
              <span className="mr-2">🍪</span>
              {ARCHIVE_MODE
                ? 'We use cookies to remember your preferences and optionally analyze archive traffic.'
                : 'We use cookies to enhance your experience and analyze site usage.'}
            </p>
            <p className="text-xs text-[var(--muted)] mt-1">
              See our{' '}
              <a href="/privacy" className="text-[var(--accent)] hover:underline font-medium">
                Privacy Policy
              </a>{' '}
              for details.
            </p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={handleDecline}
              className="flex-1 sm:flex-none px-4 py-2 text-sm border-2 border-[var(--border)] hover:border-[var(--muted)] transition-colors"
            >
              Decline
            </button>
            <button
              onClick={handleAccept}
              className="flex-1 sm:flex-none px-4 py-2 text-sm bg-[var(--accent)] text-white font-semibold hover:opacity-90 transition-opacity"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Hook to get current consent status
export function useCookieConsent() {
  const [consent, setConsent] = useState<CookieConsent>(null);

  useEffect(() => {
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (stored === 'accepted' || stored === 'declined') {
      setConsent(stored);
    }
  }, []);

  return consent;
}
