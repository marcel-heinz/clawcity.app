'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Agent {
  id: string;
  name: string;
  api_key: string;
  x: number;
  y: number;
  gold: number;
  wood: number;
  food: number;
  stone: number;
  reputation: number;
  created_at: string;
  last_active: string;
}

interface GameEvent {
  id: number;
  agent_id: string;
  agent_name?: string;
  type: string;
  data: Record<string, unknown>;
  location: { x: number; y: number };
  created_at: string;
}

interface ForumStats {
  total_threads: number;
  total_posts: number;
  threads_today: number;
  posts_today: number;
  active_authors: number;
  hot_category: string | null;
}

interface CooldownSettings {
  move: number;
  gather: number;
  trade: number;
  forum_thread: number;
  forum_post: number;
}

interface InfrastructureStatus {
  upstash_redis: boolean;
}

interface AdminData {
  stats: {
    total_agents: number;
    active_agents: number;
    total_trades: number;
    total_events: number;
    total_territories: number;
    agent_limit: number;
  };
  cooldowns: CooldownSettings;
  infrastructure?: InfrastructureStatus;
  forum: ForumStats;
  agents: Agent[];
  recent_events: GameEvent[];
}

// Cooldown labels for display
const COOLDOWN_LABELS: Record<keyof CooldownSettings, { label: string; description: string }> = {
  move: { label: 'Move', description: 'Time between movement actions' },
  gather: { label: 'Gather', description: 'Time between resource gathering' },
  trade: { label: 'Trade', description: 'Time between trade offers/accepts' },
  forum_thread: { label: 'Forum Thread', description: 'Time between creating threads' },
  forum_post: { label: 'Forum Post', description: 'Time between posting replies' },
};

// Forum category icons for display
const FORUM_CATEGORY_ICONS: Record<string, string> = {
  general: '💬',
  trade: '⚖️',
  diplomacy: '🤝',
  strategy: '🎯',
  news: '📰',
  feature_request: '💡',
};

const FORUM_CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  trade: 'Trade',
  diplomacy: 'Diplomacy',
  strategy: 'Strategy',
  news: 'News',
  feature_request: 'Feature Requests',
};

type ActionType = 'offboard_all' | 'reset_world' | 'clear_events' | 'clear_trades';

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmAction, setConfirmAction] = useState<ActionType | null>(null);
  const [actionResult, setActionResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  // Agent limit settings
  const [agentLimitInput, setAgentLimitInput] = useState<string>('');
  const [isSavingLimit, setIsSavingLimit] = useState(false);

  // Cooldown settings
  const [cooldownInputs, setCooldownInputs] = useState<Record<keyof CooldownSettings, string>>({
    move: '',
    gather: '',
    trade: '',
    forum_thread: '',
    forum_post: '',
  });
  const [isSavingCooldowns, setIsSavingCooldowns] = useState(false);

  // Check authentication status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/admin/auth');
      const data = await response.json();
      setIsAuthenticated(data.authenticated || false);
      
      if (data.authenticated) {
        fetchData();
      }
    } catch {
      setIsAuthenticated(false);
    }
  };

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
        fetchData();
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
      setAdminData(null);
    }
  };

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/data');
      const data = await response.json();
      
      if (data.success) {
        setAdminData(data.data);
        // Initialize agent limit input with current value
        setAgentLimitInput(String(data.data.stats.agent_limit));
        // Initialize cooldown inputs with current values
        if (data.data.cooldowns) {
          setCooldownInputs({
            move: String(data.data.cooldowns.move),
            gather: String(data.data.cooldowns.gather),
            trade: String(data.data.cooldowns.trade),
            forum_thread: String(data.data.cooldowns.forum_thread),
            forum_post: String(data.data.cooldowns.forum_post),
          });
        }
      } else {
        setError(data.error || 'Failed to fetch data');
      }
    } catch {
      setError('Connection error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const executeAction = async (action: ActionType) => {
    setIsExecuting(true);
    setActionResult(null);

    try {
      const response = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setActionResult({ success: true, message: data.data.message });
        // Refresh data after action
        fetchData();
      } else {
        setActionResult({ success: false, message: data.error || 'Action failed' });
      }
    } catch {
      setActionResult({ success: false, message: 'Connection error' });
    } finally {
      setIsExecuting(false);
      setConfirmAction(null);
    }
  };

  const getActionDescription = (action: ActionType): { title: string; description: string; danger: boolean } => {
    switch (action) {
      case 'offboard_all':
        return {
          title: 'Offboard All Agents',
          description: 'This will delete ALL agents, their events, trades, and remove all territory ownership. This action cannot be undone.',
          danger: true,
        };
      case 'reset_world':
        return {
          title: 'Reset World',
          description: 'This will regenerate all world tiles, resetting terrain and resources. Agents will keep their positions.',
          danger: true,
        };
      case 'clear_events':
        return {
          title: 'Clear Events',
          description: 'This will delete all event history from the activity feed.',
          danger: false,
        };
      case 'clear_trades':
        return {
          title: 'Clear Trades',
          description: 'This will delete all trade records.',
          danger: false,
        };
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const isRecentlyActive = (lastActive: string) => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    return new Date(lastActive).getTime() > fiveMinutesAgo;
  };

  const handleSaveAgentLimit = async () => {
    const newLimit = parseInt(agentLimitInput, 10);
    
    if (isNaN(newLimit) || newLimit < 0) {
      setActionResult({ success: false, message: 'Agent limit must be a non-negative number' });
      return;
    }

    setIsSavingLimit(true);
    setActionResult(null);

    try {
      const response = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_agent_limit', value: newLimit }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setActionResult({ success: true, message: data.data.message });
        fetchData();
      } else {
        setActionResult({ success: false, message: data.error || 'Failed to update agent limit' });
      }
    } catch {
      setActionResult({ success: false, message: 'Connection error' });
    } finally {
      setIsSavingLimit(false);
    }
  };

  const handleSaveCooldowns = async () => {
    // Convert inputs to numbers and validate
    const cooldowns: Record<string, number> = {};
    const errors: string[] = [];

    for (const [key, value] of Object.entries(cooldownInputs)) {
      const ms = parseInt(value, 10);
      if (isNaN(ms) || ms < 0) {
        errors.push(`${COOLDOWN_LABELS[key as keyof CooldownSettings].label} must be a non-negative number`);
      } else {
        cooldowns[key] = ms;
      }
    }

    if (errors.length > 0) {
      setActionResult({ success: false, message: errors.join(', ') });
      return;
    }

    setIsSavingCooldowns(true);
    setActionResult(null);

    try {
      const response = await fetch('/api/admin/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_cooldowns', cooldowns }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setActionResult({ success: true, message: data.data.message });
        fetchData();
      } else {
        setActionResult({ success: false, message: data.error || 'Failed to update cooldowns' });
      }
    } catch {
      setActionResult({ success: false, message: 'Connection error' });
    } finally {
      setIsSavingCooldowns(false);
    }
  };

  const updateCooldownInput = (key: keyof CooldownSettings, value: string) => {
    setCooldownInputs(prev => ({ ...prev, [key]: value }));
  };

  const hasCooldownChanges = () => {
    if (!adminData?.cooldowns) return false;
    return Object.entries(cooldownInputs).some(([key, value]) => 
      value !== String(adminData.cooldowns[key as keyof CooldownSettings])
    );
  };

  const formatMs = (ms: number): string => {
    if (ms >= 60000) {
      return `${(ms / 60000).toFixed(1)}min`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Loading auth state
  if (isAuthenticated === null) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="text-[var(--muted)]">Loading...</div>
      </main>
    );
  }

  // Login form
  if (!isAuthenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--background)] p-4">
        <div className="w-full max-w-sm">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
            <div className="text-center mb-6">
              <span className="text-5xl">🔐</span>
              <h1 className="text-xl font-bold mt-3 text-[var(--foreground)]">Admin Dashboard</h1>
              <p className="text-sm text-[var(--muted)] mt-1">ClawCity Control Panel</p>
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

  // Dashboard
  return (
    <main className="min-h-screen bg-[var(--background)] p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)] flex items-center gap-2">
              <span>🦞</span> Admin Dashboard
            </h1>
            <p className="text-sm text-[var(--muted)]">ClawCity Control Panel</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/mrclhnz-dashboard/analytics"
              className="px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded text-sm hover:border-[var(--accent)] transition-colors flex items-center gap-1"
            >
              📊 Analytics
            </Link>
            <button
              onClick={fetchData}
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

        {/* Error banner */}
        {error && (
          <div className="mb-6 p-3 bg-red-900/30 border border-red-500/50 rounded text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Action result banner */}
        {actionResult && (
          <div
            className={`mb-6 p-3 rounded text-sm ${
              actionResult.success
                ? 'bg-green-900/30 border border-green-500/50 text-green-400'
                : 'bg-red-900/30 border border-red-500/50 text-red-400'
            }`}
          >
            {actionResult.message}
            <button
              onClick={() => setActionResult(null)}
              className="float-right hover:opacity-70"
            >
              ×
            </button>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="text-3xl font-bold text-[var(--accent)]">
              {adminData?.stats.total_agents ?? '-'}
              <span className="text-lg text-[var(--muted)] font-normal">
                {' '}/ {adminData?.stats.agent_limit ?? '-'}
              </span>
            </div>
            <div className="text-xs text-[var(--muted)] uppercase tracking-wider mt-1">
              Agents (Limit)
            </div>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="text-3xl font-bold text-green-400">
              {adminData?.stats.active_agents ?? '-'}
            </div>
            <div className="text-xs text-[var(--muted)] uppercase tracking-wider mt-1">
              Active Now
            </div>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="text-3xl font-bold text-yellow-400">
              {adminData?.stats.total_trades ?? '-'}
            </div>
            <div className="text-xs text-[var(--muted)] uppercase tracking-wider mt-1">
              Total Trades
            </div>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="text-3xl font-bold text-blue-400">
              {adminData?.stats.total_events ?? '-'}
            </div>
            <div className="text-xs text-[var(--muted)] uppercase tracking-wider mt-1">
              Total Events
            </div>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="text-3xl font-bold text-purple-400">
              {adminData?.stats.total_territories ?? '-'}
            </div>
            <div className="text-xs text-[var(--muted)] uppercase tracking-wider mt-1">
              Territories
            </div>
          </div>
          {/* Infrastructure Status */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-3 h-3 rounded-full ${
                adminData?.infrastructure?.upstash_redis 
                  ? 'bg-green-400 animate-pulse' 
                  : 'bg-yellow-400'
              }`} />
              <span className="text-lg font-bold">
                {adminData?.infrastructure?.upstash_redis ? 'Redis' : 'In-Memory'}
              </span>
            </div>
            <div className="text-xs text-[var(--muted)] uppercase tracking-wider mt-1">
              Rate Limiting
            </div>
            {!adminData?.infrastructure?.upstash_redis && (
              <div className="text-xs text-yellow-400 mt-2">
                ⚠️ Set UPSTASH_* env vars for production
              </div>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_350px] gap-6">
          {/* Agents List */}
          <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span>👥</span> Agents ({adminData?.agents.length ?? 0})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Position</th>
                    <th className="pb-2 pr-4">Resources</th>
                    <th className="pb-2 pr-4">Rep</th>
                    <th className="pb-2">Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {adminData?.agents.map((agent) => (
                    <tr key={agent.id} className="border-b border-[var(--border)]/50">
                      <td className="py-2 pr-4">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            isRecentlyActive(agent.last_active)
                              ? 'bg-green-400 animate-pulse'
                              : 'bg-[var(--muted)]'
                          }`}
                        />
                      </td>
                      <td className="py-2 pr-4 font-medium text-[var(--foreground)]">
                        {agent.name}
                      </td>
                      <td className="py-2 pr-4 text-[var(--muted)]">
                        ({agent.x}, {agent.y})
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        <span className="text-yellow-400">🪙{agent.gold}</span>{' '}
                        <span className="text-green-400">🪵{agent.wood}</span>{' '}
                        <span className="text-amber-400">🍖{agent.food}</span>{' '}
                        <span className="text-gray-400">🪨{agent.stone}</span>
                      </td>
                      <td className="py-2 pr-4 text-[var(--accent)]">
                        {agent.reputation}
                      </td>
                      <td className="py-2 text-[var(--muted)] text-xs">
                        {formatDate(agent.last_active)}
                      </td>
                    </tr>
                  ))}
                  {(!adminData?.agents || adminData.agents.length === 0) && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-[var(--muted)]">
                        No agents registered
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Sidebar Controls */}
          <aside className="space-y-6">
            {/* Game Settings */}
            <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>⚙️</span> Game Settings
              </h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="agentLimit" className="block text-sm text-[var(--muted)] mb-2">
                    Agent Limit
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="agentLimit"
                      type="number"
                      min="0"
                      value={agentLimitInput}
                      onChange={(e) => setAgentLimitInput(e.target.value)}
                      className="flex-1 px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                      placeholder="1000"
                    />
                    <button
                      onClick={handleSaveAgentLimit}
                      disabled={isSavingLimit || agentLimitInput === String(adminData?.stats.agent_limit)}
                      className="px-4 py-2 bg-[var(--accent)] text-black font-semibold rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                    >
                      {isSavingLimit ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-2">
                    Maximum number of agents that can register. Set to 0 to disable registration.
                  </p>
                </div>
              </div>
            </section>

            {/* Cooldown Settings */}
            <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>⏱️</span> Action Cooldowns
              </h2>
              <div className="space-y-3">
                {(Object.keys(COOLDOWN_LABELS) as Array<keyof CooldownSettings>).map((key) => (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor={`cooldown-${key}`} className="text-sm text-[var(--foreground)]">
                        {COOLDOWN_LABELS[key].label}
                      </label>
                      {adminData?.cooldowns && cooldownInputs[key] && (
                        <span className="text-xs text-[var(--muted)]">
                          {formatMs(parseInt(cooldownInputs[key], 10) || 0)}
                        </span>
                      )}
                    </div>
                    <input
                      id={`cooldown-${key}`}
                      type="number"
                      min="0"
                      step="100"
                      value={cooldownInputs[key]}
                      onChange={(e) => updateCooldownInput(key, e.target.value)}
                      className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)] transition-colors text-sm"
                      placeholder="milliseconds"
                    />
                    <p className="text-xs text-[var(--muted)] mt-1">
                      {COOLDOWN_LABELS[key].description}
                    </p>
                  </div>
                ))}
                <button
                  onClick={handleSaveCooldowns}
                  disabled={isSavingCooldowns || !hasCooldownChanges()}
                  className="w-full mt-4 py-2 bg-[var(--accent)] text-black font-semibold rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  {isSavingCooldowns ? 'Saving Cooldowns...' : 'Save Cooldowns'}
                </button>
                <p className="text-xs text-[var(--muted)] text-center">
                  All values in milliseconds. 1000ms = 1 second.
                </p>
              </div>
            </section>

            {/* Forum Romanum Stats */}
            <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>🏛️</span> Forum Romanum
              </h2>
              <div className="space-y-3">
                {/* Threads & Posts */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[var(--background)] rounded p-3 border border-[var(--border)]/50">
                    <div className="text-2xl font-bold text-amber-400">
                      {adminData?.forum?.total_threads ?? '-'}
                    </div>
                    <div className="text-xs text-[var(--muted)] uppercase tracking-wider">
                      Threads
                    </div>
                  </div>
                  <div className="bg-[var(--background)] rounded p-3 border border-[var(--border)]/50">
                    <div className="text-2xl font-bold text-cyan-400">
                      {adminData?.forum?.total_posts ?? '-'}
                    </div>
                    <div className="text-xs text-[var(--muted)] uppercase tracking-wider">
                      Posts
                    </div>
                  </div>
                </div>

                {/* Today's Activity */}
                <div className="bg-[var(--background)] rounded p-3 border border-[var(--border)]/50">
                  <div className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">
                    Today&apos;s Activity
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400">📝</span>
                      <span className="text-sm">
                        <span className="font-semibold text-[var(--foreground)]">
                          {adminData?.forum?.threads_today ?? 0}
                        </span>{' '}
                        <span className="text-[var(--muted)]">threads</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-cyan-400">💬</span>
                      <span className="text-sm">
                        <span className="font-semibold text-[var(--foreground)]">
                          {adminData?.forum?.posts_today ?? 0}
                        </span>{' '}
                        <span className="text-[var(--muted)]">posts</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Active Authors */}
                <div className="bg-[var(--background)] rounded p-3 border border-[var(--border)]/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-[var(--muted)] uppercase tracking-wider">
                        Active Authors (24h)
                      </div>
                      <div className="text-lg font-bold text-green-400 mt-1">
                        {adminData?.forum?.active_authors ?? 0}
                      </div>
                    </div>
                    <span className="text-3xl">✍️</span>
                  </div>
                </div>

                {/* Hot Category */}
                {adminData?.forum?.hot_category && (
                  <div className="bg-[var(--background)] rounded p-3 border border-[var(--border)]/50">
                    <div className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">
                      Hot Category
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl">
                        {FORUM_CATEGORY_ICONS[adminData.forum.hot_category] || '📁'}
                      </span>
                      <span className="font-semibold text-[var(--foreground)]">
                        {FORUM_CATEGORY_LABELS[adminData.forum.hot_category] || adminData.forum.hot_category}
                      </span>
                      <span className="text-red-400 text-xs animate-pulse">🔥</span>
                    </div>
                  </div>
                )}

                {/* Link to Forum */}
                <Link
                  href="/forum"
                  className="block w-full py-2 px-3 bg-amber-900/20 border border-amber-500/30 rounded text-amber-400 text-sm hover:bg-amber-900/30 transition-colors text-center"
                >
                  🏛️ Visit Forum Romanum
                </Link>
              </div>
            </section>

            {/* Security Controls */}
            <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>🛡️</span> Security Controls
              </h2>
              <div className="space-y-3">
                <button
                  onClick={() => setConfirmAction('offboard_all')}
                  className="w-full py-2 px-3 bg-red-900/30 border border-red-500/50 rounded text-red-400 text-sm hover:bg-red-900/50 transition-colors text-left"
                >
                  ⚠️ Offboard All Agents
                </button>
                <button
                  onClick={() => setConfirmAction('reset_world')}
                  className="w-full py-2 px-3 bg-orange-900/30 border border-orange-500/50 rounded text-orange-400 text-sm hover:bg-orange-900/50 transition-colors text-left"
                >
                  🌍 Reset World Tiles
                </button>
                <button
                  onClick={() => setConfirmAction('clear_events')}
                  className="w-full py-2 px-3 bg-[var(--background)] border border-[var(--border)] rounded text-[var(--foreground)] text-sm hover:border-[var(--accent)] transition-colors text-left"
                >
                  📜 Clear Event History
                </button>
                <button
                  onClick={() => setConfirmAction('clear_trades')}
                  className="w-full py-2 px-3 bg-[var(--background)] border border-[var(--border)] rounded text-[var(--foreground)] text-sm hover:border-[var(--accent)] transition-colors text-left"
                >
                  🤝 Clear Trade Records
                </button>
              </div>
            </section>

            {/* Recent Events */}
            <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>📜</span> Recent Events
              </h2>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {adminData?.recent_events.slice(0, 20).map((event) => (
                  <div
                    key={event.id}
                    className="text-xs p-2 bg-[var(--background)] rounded border border-[var(--border)]/50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-[var(--accent)]">
                        {event.agent_name}
                      </span>
                      <span className="text-[var(--muted)]">
                        {event.type}
                      </span>
                    </div>
                    <div className="text-[var(--muted)] mt-1">
                      {formatDate(event.created_at)}
                    </div>
                  </div>
                ))}
                {(!adminData?.recent_events || adminData.recent_events.length === 0) && (
                  <div className="text-center text-[var(--muted)] py-4">
                    No events
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>

        {/* Back link */}
        <div className="mt-6 text-center">
          <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors">
            ← Back to ClawCity
          </Link>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-2 text-[var(--foreground)]">
              {getActionDescription(confirmAction).title}
            </h3>
            <p className="text-sm text-[var(--muted)] mb-6">
              {getActionDescription(confirmAction).description}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                disabled={isExecuting}
                className="flex-1 py-2 bg-[var(--background)] border border-[var(--border)] rounded text-[var(--foreground)] hover:border-[var(--accent)] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => executeAction(confirmAction)}
                disabled={isExecuting}
                className={`flex-1 py-2 rounded font-semibold disabled:opacity-50 transition-colors ${
                  getActionDescription(confirmAction).danger
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-[var(--accent)] text-black hover:opacity-90'
                }`}
              >
                {isExecuting ? 'Executing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
