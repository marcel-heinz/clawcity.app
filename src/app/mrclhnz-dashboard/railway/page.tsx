'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type AllowedModel = 'z-ai/glm-5' | 'minimax/minimax-m2.5';

const rawAdminPath = process.env.NEXT_PUBLIC_ADMIN_PATH || '/mrclhnz-dashboard';
const adminPath = rawAdminPath.startsWith('/') ? rawAdminPath : `/${rawAdminPath}`;

interface RailwaySettingsData {
  model: AllowedModel;
  models: AllowedModel[];
  status?: {
    gateway_healthy: boolean;
    active_model: AllowedModel | null;
    is_active: boolean;
    checked_at: string;
  };
}

export default function RailwaySettingsPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [settings, setSettings] = useState<RailwaySettingsData | null>(null);
  const [selectedModel, setSelectedModel] = useState<AllowedModel>('z-ai/glm-5');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const status = settings?.status;
  const activeModel = status?.active_model || settings?.model || null;
  const isGatewayHealthy = status?.gateway_healthy ?? false;
  const isRailwayActive = status?.is_active ?? false;
  const statusLabel = !status
    ? 'Status unknown'
    : !isGatewayHealthy
      ? 'Gateway unreachable'
      : isRailwayActive
        ? 'Active on Railway'
        : 'Pending propagation';

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/railway-settings');
      const data = await response.json();

      if (!response.ok || !data.success || !data.data) {
        setError(data.error || 'Failed to fetch Railway settings');
        return;
      }

      const nextSettings = data.data as RailwaySettingsData;
      setSettings(nextSettings);
      setSelectedModel(nextSettings.model);
    } catch {
      setError('Connection error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/auth');
      const data = await response.json();
      setIsAuthenticated(data.authenticated || false);
      if (data.authenticated) {
        fetchSettings();
      }
    } catch {
      setIsAuthenticated(false);
    }
  }, [fetchSettings]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();

      if (data.success) {
        setIsAuthenticated(true);
        setPassword('');
        fetchSettings();
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch {
      setLoginError('Connection error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/auth', { method: 'DELETE' });
    } finally {
      setIsAuthenticated(false);
      setSettings(null);
      setMessage(null);
      setError(null);
    }
  };

  const handleSave = async () => {
    if (!settings || selectedModel === settings.model) return;

    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/railway-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel }),
      });
      const data = await response.json();

      if (!response.ok || !data.success || !data.data) {
        setError(data.error || 'Failed to update model');
        return;
      }

      const nextSettings = data.data as RailwaySettingsData;
      setSettings(nextSettings);
      setSelectedModel(nextSettings.model);
      if (nextSettings.status?.is_active) {
        setMessage(`Global model updated and active on Railway: ${nextSettings.model}.`);
      } else {
        setMessage(
          `Model saved as ${nextSettings.model}. Railway has not confirmed activation yet. Refresh to verify.`
        );
      }
    } catch {
      setError('Connection error');
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthenticated === null) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="text-[var(--muted)]">Loading...</div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--background)] p-4">
        <div className="w-full max-w-sm">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
            <div className="text-center mb-6">
              <span className="text-5xl">🚂</span>
              <h1 className="text-xl font-bold mt-3 text-[var(--foreground)]">Railway Agent Settings</h1>
              <p className="text-sm text-[var(--muted)] mt-1">OpenClaw Gateway Model Control</p>
            </div>

            <form onSubmit={handleLogin}>
              <div className="mb-4">
                <label htmlFor="password" className="block text-sm text-[var(--muted)] mb-2">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                  placeholder="Enter admin password"
                  autoFocus
                />
              </div>

              {loginError && (
                <div className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded text-red-400 text-sm">
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoggingIn || !password}
                className="w-full py-2 bg-[var(--accent)] text-black font-semibold rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {isLoggingIn ? 'Logging in...' : 'Login'}
              </button>
            </form>

            <div className="mt-4 text-center">
              <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors">
                ← Back to ClawCity
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--background)] p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)] flex items-center gap-2">
              <span>🚂</span> Railway Agent Settings
            </h1>
            <p className="text-sm text-[var(--muted)]">Global OpenRouter model for Builder + OpenClaw Gateway</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={adminPath}
              className="px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded text-sm hover:border-[var(--accent)] transition-colors"
            >
              ← Admin Dashboard
            </Link>
            <Link
              href={`${adminPath}/analytics`}
              className="px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded text-sm hover:border-[var(--accent)] transition-colors"
            >
              📊 Analytics
            </Link>
            <button
              onClick={fetchSettings}
              disabled={isLoading}
              className="px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded text-sm hover:border-[var(--accent)] disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Refreshing...' : '↻ Refresh'}
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 bg-red-900/30 border border-red-500/50 rounded text-red-400 text-sm hover:bg-red-900/50 transition-colors"
            >
              Logout
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-6 p-3 bg-red-900/30 border border-red-500/50 rounded text-red-400 text-sm">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-6 p-3 bg-green-900/30 border border-green-500/50 rounded text-green-400 text-sm">
            {message}
          </div>
        )}

        <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">OpenRouter Model</h2>
          <p className="text-sm text-[var(--muted)] mb-4">
            This updates the model globally in OpenClaw Gateway and Builder SOUL generation.
          </p>

          <div className="mb-4 p-3 bg-[var(--background)] border border-[var(--border)] rounded">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  !status
                    ? 'bg-[var(--muted)]'
                    : !isGatewayHealthy
                      ? 'bg-red-400'
                      : isRailwayActive
                        ? 'bg-green-400 animate-pulse'
                        : 'bg-yellow-400'
                }`}
              />
              <span className="text-sm font-medium text-[var(--foreground)]">{statusLabel}</span>
            </div>
            <div className="text-xs text-[var(--muted)] mt-2">
              Active model on Railway: {activeModel || '-'}
            </div>
            <div className="text-xs text-[var(--muted)] mt-1">
              Last check: {status?.checked_at ? new Date(status.checked_at).toLocaleString() : '-'}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="global-model" className="block text-sm text-[var(--muted)] mb-2">
                Active model
              </label>
              <select
                id="global-model"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as AllowedModel)}
                className="w-full max-w-md px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                disabled={isLoading || !settings}
              >
                {(settings?.models || []).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={isSaving || !settings || selectedModel === settings.model}
                className="px-4 py-2 bg-[var(--accent)] text-black font-semibold rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {isSaving ? 'Saving...' : 'Save Model'}
              </button>
              <span className="text-sm text-[var(--muted)]">
                Current: {settings?.model || '-'}
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
