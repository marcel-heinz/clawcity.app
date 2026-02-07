'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import Link from 'next/link';

interface DashboardData {
  profile: {
    tier: string;
    max_decisions_per_day: number;
    decisions_used_today: number;
    stripe_subscription_id: string | null;
  };
  config: {
    id: string;
    agent_name: string;
    is_active: boolean;
    agent_id: string | null;
    personality_preset: string;
    created_at: string;
  } | null;
  agent: {
    x: number;
    y: number;
    gold: number;
    wood: number;
    food: number;
    stone: number;
    reputation: number;
    last_active: string;
  } | null;
  stats: {
    total_decisions: number;
    successful_decisions: number;
    ai_decisions: number;
    rule_decisions: number;
  };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/user/profile');
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const handleManageBilling = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      // ignore
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen p-4 md:p-6 max-w-[1200px] mx-auto">
        <div className="text-center py-20 text-[var(--muted)]">Loading dashboard...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-6 max-w-[1200px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--foreground)] mb-1">Dashboard</h1>
        <p className="text-sm text-[var(--muted)]">
          Welcome back, {user?.user_metadata?.full_name || user?.email?.split('@')[0]}
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Agent Status */}
        <div className="pixel-card p-4">
          <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3 flex items-center gap-2">
            Agent Status
          </h3>
          {data?.config ? (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-3 h-3 rounded-full ${data.config.is_active ? 'bg-[var(--accent)]' : 'bg-[var(--muted)]'}`} />
                <span className="font-semibold text-[var(--foreground)]">{data.config.agent_name}</span>
              </div>
              <div className="text-xs space-y-1 text-[var(--muted)]">
                <div>Status: <span className={data.config.is_active ? 'text-[var(--accent)]' : 'text-[var(--red)]'}>{data.config.is_active ? 'Active' : 'Paused'}</span></div>
                <div>Preset: <span className="text-[var(--foreground)] capitalize">{data.config.personality_preset}</span></div>
              </div>
              <div className="mt-3">
                <Link href="/builder" className="text-xs text-[var(--accent)] hover:underline font-medium">
                  Edit in Builder &rarr;
                </Link>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[var(--muted)]">
              <p className="mb-3">No agent configured yet.</p>
              <Link href="/builder" className="pixel-btn px-4 py-2 bg-[var(--accent)] text-white text-xs font-semibold inline-block">
                Create Agent
              </Link>
            </div>
          )}
        </div>

        {/* Usage */}
        <div className="pixel-card p-4">
          <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">Usage</h3>
          {data?.profile && data.profile.tier !== 'free' ? (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[var(--muted)]">Decisions today</span>
                <span className="font-semibold text-[var(--foreground)]">
                  {data.profile.decisions_used_today} / {data.profile.max_decisions_per_day}
                </span>
              </div>
              <div className="pixel-progress-track">
                <div
                  className="pixel-progress-fill"
                  style={{
                    width: `${Math.min(100, (data.profile.decisions_used_today / data.profile.max_decisions_per_day) * 100)}%`,
                  }}
                />
              </div>
              {data.stats && (
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[var(--surface-alt)] p-2 border border-[var(--border)]">
                    <div className="text-[var(--muted)]">Total decisions</div>
                    <div className="font-semibold text-[var(--foreground)]">{data.stats.total_decisions}</div>
                  </div>
                  <div className="bg-[var(--surface-alt)] p-2 border border-[var(--border)]">
                    <div className="text-[var(--muted)]">Success rate</div>
                    <div className="font-semibold text-[var(--foreground)]">
                      {data.stats.total_decisions > 0
                        ? Math.round((data.stats.successful_decisions / data.stats.total_decisions) * 100)
                        : 0}%
                    </div>
                  </div>
                  <div className="bg-[var(--surface-alt)] p-2 border border-[var(--border)]">
                    <div className="text-[var(--muted)]">AI decisions</div>
                    <div className="font-semibold text-[var(--foreground)]">{data.stats.ai_decisions}</div>
                  </div>
                  <div className="bg-[var(--surface-alt)] p-2 border border-[var(--border)]">
                    <div className="text-[var(--muted)]">Rule decisions</div>
                    <div className="font-semibold text-[var(--foreground)]">{data.stats.rule_decisions}</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-[var(--muted)]">
              <p className="mb-3">Upgrade to start tracking usage.</p>
              <Link href="/pricing" className="text-[var(--accent)] hover:underline font-medium">
                View Plans &rarr;
              </Link>
            </div>
          )}
        </div>

        {/* Subscription */}
        <div className="pixel-card p-4">
          <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">Subscription</h3>
          <div className="mb-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 pixel-badge">
              <span className="capitalize">{data?.profile?.tier || 'free'}</span>
            </div>
          </div>
          {data?.profile?.tier === 'free' ? (
            <Link href="/pricing" className="pixel-btn px-4 py-2 bg-[var(--gold)] text-white text-xs font-semibold inline-block">
              Upgrade
            </Link>
          ) : (
            <button
              onClick={handleManageBilling}
              disabled={portalLoading}
              className="pixel-btn px-4 py-2 bg-[var(--surface)] text-[var(--foreground)] text-xs font-semibold disabled:opacity-50"
            >
              {portalLoading ? 'Loading...' : 'Manage Billing'}
            </button>
          )}
        </div>

        {/* Agent Resources */}
        {data?.agent && (
          <div className="pixel-card p-4 md:col-span-2 lg:col-span-3">
            <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">Agent Resources</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {[
                { label: 'Position', value: `(${data.agent.x}, ${data.agent.y})`, color: 'var(--foreground)' },
                { label: 'Gold', value: data.agent.gold, color: 'var(--gold)' },
                { label: 'Wood', value: data.agent.wood, color: 'var(--accent)' },
                { label: 'Food', value: data.agent.food, color: '#c94a4a' },
                { label: 'Stone', value: data.agent.stone, color: 'var(--muted)' },
                { label: 'Reputation', value: data.agent.reputation, color: '#4a7ec9' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-[var(--surface-alt)] p-3 border-2 border-[var(--border)] text-center">
                  <div className="text-xs text-[var(--muted)] mb-1">{label}</div>
                  <div className="font-bold text-sm" style={{ color }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
