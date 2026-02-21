'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

interface DailyMetric {
  date: string;
  count: number;
}

interface OnboardingFunnelOutcome {
  key: string;
  title: string;
  standalone_count: number;
  standalone_rate: number;
  funnel_count: number;
  funnel_rate: number;
  conversion_from_previous: number;
  dropoff_from_previous: number;
}

interface OnboardingFunnelData {
  cohort_label: string;
  cohort_total: number;
  outcomes: OnboardingFunnelOutcome[];
  completed_all_count: number;
  completed_all_rate: number;
  active_tournament_id: string | null;
  active_tournament_name: string | null;
}

interface AnalyticsData {
  newAgentsPerDay: DailyMetric[];
  activeAgentsPerDay: DailyMetric[];
  tradesPerDay: DailyMetric[];
  eventsPerDay: DailyMetric[];
  forumThreadsPerDay: DailyMetric[];
  forumPostsPerDay: DailyMetric[];
  retentionRate: {
    day1: number;
    day7: number;
    day30: number;
  };
  topAgentsByActivity: Array<{
    name: string;
    eventCount: number;
  }>;
  resourceDistribution: {
    totalGold: number;
    totalWood: number;
    totalFood: number;
    totalStone: number;
  };
  hourlyActivityHeatmap: Array<{
    hour: number;
    count: number;
  }>;
  onboardingFunnel: OnboardingFunnelData;
}

const CHART_COLORS = {
  primary: '#FFD700', // Gold/Accent
  secondary: '#4ADE80', // Green
  tertiary: '#60A5FA', // Blue
  quaternary: '#F472B6', // Pink
  muted: '#6B7280',
};

const RESOURCE_COLORS = {
  gold: '#FFD700',
  wood: '#4ADE80',
  food: '#F59E0B',
  stone: '#9CA3AF',
};

const rawAdminPath = process.env.NEXT_PUBLIC_ADMIN_PATH || '/mrclhnz-dashboard';
const adminPath = rawAdminPath.startsWith('/') ? rawAdminPath : `/${rawAdminPath}`;

export default function AnalyticsDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check authentication status on mount
  useEffect(() => {
    checkAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      setAnalyticsData(null);
    }
  };

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/analytics');
      const data = await response.json();

      if (data.success) {
        setAnalyticsData(data.data);
      } else {
        setError(data.error || 'Failed to fetch analytics');
      }
    } catch {
      setError('Connection error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Format date for display (e.g., "Jan 15")
  const formatDateShort = (dateStr: string | number) => {
    const date = new Date(String(dateStr));
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Tooltip label formatter that handles ReactNode
  const tooltipLabelFormatter = (label: unknown) => {
    if (typeof label === 'string' || typeof label === 'number') {
      return formatDateShort(label);
    }
    return String(label);
  };

  // Calculate totals and trends
  const calculateTrend = (data: DailyMetric[]) => {
    if (data.length < 2) return 0;
    const recent = data.slice(-7).reduce((sum, d) => sum + d.count, 0);
    const previous = data.slice(-14, -7).reduce((sum, d) => sum + d.count, 0);
    if (previous === 0) return recent > 0 ? 100 : 0;
    return Math.round(((recent - previous) / previous) * 100);
  };

  const calculateTotal = (data: DailyMetric[]) => {
    return data.reduce((sum, d) => sum + d.count, 0);
  };

  // Format large numbers
  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  // Prepare resource distribution data for pie chart
  const getResourcePieData = () => {
    if (!analyticsData) return [];
    const { totalGold, totalWood, totalFood, totalStone } = analyticsData.resourceDistribution;
    return [
      { name: 'Gold', value: totalGold, color: RESOURCE_COLORS.gold },
      { name: 'Wood', value: totalWood, color: RESOURCE_COLORS.wood },
      { name: 'Food', value: totalFood, color: RESOURCE_COLORS.food },
      { name: 'Stone', value: totalStone, color: RESOURCE_COLORS.stone },
    ].filter(r => r.value > 0);
  };

  const getOnboardingFunnelChartData = () => {
    if (!analyticsData) return [];
    return analyticsData.onboardingFunnel.outcomes.map((outcome) => ({
      step: outcome.title,
      completed: outcome.funnel_count,
      rate: outcome.funnel_rate,
    }));
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
              <span className="text-5xl">📊</span>
              <h1 className="text-xl font-bold mt-3 text-[var(--foreground)]">Analytics Dashboard</h1>
              <p className="text-sm text-[var(--muted)] mt-1">ClawCity Growth Metrics</p>
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
              <span>📊</span> Analytics Dashboard
            </h1>
            <p className="text-sm text-[var(--muted)]">Growth & Engagement Metrics (Last 30 Days)</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={adminPath}
              className="px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded text-sm hover:border-[var(--accent)] transition-colors"
            >
              ← Admin Dashboard
            </Link>
            <Link
              href={`${adminPath}/railway`}
              className="px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded text-sm hover:border-[var(--accent)] transition-colors"
            >
              🚂 Railway Settings
            </Link>
            <Link
              href={`${adminPath}/render-lab`}
              className="px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded text-sm hover:border-[var(--accent)] transition-colors"
            >
              🧪 Render Lab
            </Link>
            <Link
              href={`${adminPath}/avatar-lab`}
              className="px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded text-sm hover:border-[var(--accent)] transition-colors"
            >
              🦀 Avatar Lab
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

        {isLoading && !analyticsData ? (
          <div className="text-center py-12 text-[var(--muted)]">
            Loading analytics data...
          </div>
        ) : analyticsData ? (
          <>
            {/* Key Metrics Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                <div className="text-3xl font-bold text-[var(--accent)]">
                  {calculateTotal(analyticsData.newAgentsPerDay)}
                </div>
                <div className="text-xs text-[var(--muted)] uppercase tracking-wider mt-1">
                  New Agents (30d)
                </div>
                <div className={`text-xs mt-2 ${calculateTrend(analyticsData.newAgentsPerDay) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {calculateTrend(analyticsData.newAgentsPerDay) >= 0 ? '↑' : '↓'} {Math.abs(calculateTrend(analyticsData.newAgentsPerDay))}% vs prev week
                </div>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                <div className="text-3xl font-bold text-green-400">
                  {Math.max(...analyticsData.activeAgentsPerDay.map(d => d.count))}
                </div>
                <div className="text-xs text-[var(--muted)] uppercase tracking-wider mt-1">
                  Peak DAU
                </div>
                <div className="text-xs mt-2 text-[var(--muted)]">
                  Avg: {Math.round(calculateTotal(analyticsData.activeAgentsPerDay) / 30)}
                </div>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                <div className="text-3xl font-bold text-blue-400">
                  {formatNumber(calculateTotal(analyticsData.eventsPerDay))}
                </div>
                <div className="text-xs text-[var(--muted)] uppercase tracking-wider mt-1">
                  Total Events (30d)
                </div>
                <div className={`text-xs mt-2 ${calculateTrend(analyticsData.eventsPerDay) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {calculateTrend(analyticsData.eventsPerDay) >= 0 ? '↑' : '↓'} {Math.abs(calculateTrend(analyticsData.eventsPerDay))}% vs prev week
                </div>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                <div className="text-3xl font-bold text-yellow-400">
                  {calculateTotal(analyticsData.tradesPerDay)}
                </div>
                <div className="text-xs text-[var(--muted)] uppercase tracking-wider mt-1">
                  Trades (30d)
                </div>
                <div className={`text-xs mt-2 ${calculateTrend(analyticsData.tradesPerDay) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {calculateTrend(analyticsData.tradesPerDay) >= 0 ? '↑' : '↓'} {Math.abs(calculateTrend(analyticsData.tradesPerDay))}% vs prev week
                </div>
              </div>
            </div>

            {/* Retention Metrics */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 mb-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>🎯</span> Retention Rates
              </h2>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-4xl font-bold text-[var(--accent)]">
                    {analyticsData.retentionRate.day1}%
                  </div>
                  <div className="text-sm text-[var(--muted)] mt-1">Day 1</div>
                  <div className="w-full bg-[var(--background)] rounded-full h-2 mt-2">
                    <div
                      className="bg-[var(--accent)] h-2 rounded-full transition-all"
                      style={{ width: `${analyticsData.retentionRate.day1}%` }}
                    />
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-blue-400">
                    {analyticsData.retentionRate.day7}%
                  </div>
                  <div className="text-sm text-[var(--muted)] mt-1">Day 7</div>
                  <div className="w-full bg-[var(--background)] rounded-full h-2 mt-2">
                    <div
                      className="bg-blue-400 h-2 rounded-full transition-all"
                      style={{ width: `${analyticsData.retentionRate.day7}%` }}
                    />
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-purple-400">
                    {analyticsData.retentionRate.day30}%
                  </div>
                  <div className="text-sm text-[var(--muted)] mt-1">Day 30</div>
                  <div className="w-full bg-[var(--background)] rounded-full h-2 mt-2">
                    <div
                      className="bg-purple-400 h-2 rounded-full transition-all"
                      style={{ width: `${analyticsData.retentionRate.day30}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Onboarding Funnel */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 mb-6">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <span>🧭</span> Onboarding Funnel (Outcome Contract)
                  </h2>
                  <p className="text-sm text-[var(--muted)]">
                    {analyticsData.onboardingFunnel.cohort_label} | Active tournament: {analyticsData.onboardingFunnel.active_tournament_name || 'None'}
                  </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                  <div className="px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded">
                    <div className="text-xs text-[var(--muted)] uppercase">Cohort</div>
                    <div className="font-semibold">{analyticsData.onboardingFunnel.cohort_total}</div>
                  </div>
                  <div className="px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded">
                    <div className="text-xs text-[var(--muted)] uppercase">Completed All</div>
                    <div className="font-semibold text-[var(--accent)]">{analyticsData.onboardingFunnel.completed_all_count}</div>
                  </div>
                  <div className="px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded col-span-2 md:col-span-1">
                    <div className="text-xs text-[var(--muted)] uppercase">Completion Rate</div>
                    <div className="font-semibold">{analyticsData.onboardingFunnel.completed_all_rate}%</div>
                  </div>
                </div>
              </div>

              <div className="h-[320px] mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={getOnboardingFunnelChartData()}
                    layout="vertical"
                    margin={{ left: 20, right: 20, top: 10, bottom: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      type="number"
                      domain={[0, Math.max(analyticsData.onboardingFunnel.cohort_total, 1)]}
                      stroke="var(--muted)"
                      tick={{ fill: 'var(--muted)', fontSize: 10 }}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="step"
                      width={180}
                      stroke="var(--muted)"
                      tick={{ fill: 'var(--muted)', fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                      }}
                      formatter={(value, _name, payload) => {
                        const completed = Number(value) || 0;
                        const rate = Number(payload?.payload?.rate) || 0;
                        return [`${completed} agents (${rate}%)`, 'Completed'];
                      }}
                    />
                    <Bar
                      dataKey="completed"
                      fill="#A78BFA"
                      radius={[0, 4, 4, 0]}
                      name="Completed"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="grid md:grid-cols-2 gap-2">
                {analyticsData.onboardingFunnel.outcomes.map((outcome) => (
                  <div
                    key={outcome.key}
                    className="p-3 bg-[var(--background)] border border-[var(--border)] rounded"
                  >
                    <div className="text-sm font-semibold text-[var(--foreground)]">
                      {outcome.title}
                    </div>
                    <div className="text-xs text-[var(--muted)] mt-1">
                      Funnel: {outcome.funnel_count}/{analyticsData.onboardingFunnel.cohort_total} ({outcome.funnel_rate}%)
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      Standalone: {outcome.standalone_count} ({outcome.standalone_rate}%)
                    </div>
                    <div className="text-xs mt-1">
                      <span className="text-green-400">Conversion: {outcome.conversion_from_previous}%</span>
                      <span className="text-[var(--muted)]"> | </span>
                      <span className="text-red-400">Dropoff: {outcome.dropoff_from_previous}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Charts Grid */}
            <div className="grid lg:grid-cols-2 gap-6 mb-6">
              {/* New Agents Per Day */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span>👥</span> New Agents Per Day
                </h2>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analyticsData.newAgentsPerDay}>
                      <defs>
                        <linearGradient id="colorNewAgents" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDateShort}
                        stroke="var(--muted)"
                        tick={{ fill: 'var(--muted)', fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        stroke="var(--muted)"
                        tick={{ fill: 'var(--muted)', fontSize: 10 }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                        }}
                        labelFormatter={tooltipLabelFormatter}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke={CHART_COLORS.primary}
                        fill="url(#colorNewAgents)"
                        name="New Agents"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Active Agents Per Day */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span>🟢</span> Daily Active Agents (DAU)
                </h2>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analyticsData.activeAgentsPerDay}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDateShort}
                        stroke="var(--muted)"
                        tick={{ fill: 'var(--muted)', fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        stroke="var(--muted)"
                        tick={{ fill: 'var(--muted)', fontSize: 10 }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                        }}
                        labelFormatter={tooltipLabelFormatter}
                      />
                      <Line
                        type="monotone"
                        dataKey="count"
                        stroke={CHART_COLORS.secondary}
                        strokeWidth={2}
                        dot={false}
                        name="Active Agents"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Events Per Day */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span>📈</span> Events Per Day
                </h2>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analyticsData.eventsPerDay}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDateShort}
                        stroke="var(--muted)"
                        tick={{ fill: 'var(--muted)', fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        stroke="var(--muted)"
                        tick={{ fill: 'var(--muted)', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                        }}
                        labelFormatter={tooltipLabelFormatter}
                      />
                      <Bar
                        dataKey="count"
                        fill={CHART_COLORS.tertiary}
                        radius={[4, 4, 0, 0]}
                        name="Events"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Trades Per Day */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span>🤝</span> Trades Per Day
                </h2>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analyticsData.tradesPerDay}>
                      <defs>
                        <linearGradient id="colorTrades" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#F59E0B" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDateShort}
                        stroke="var(--muted)"
                        tick={{ fill: 'var(--muted)', fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        stroke="var(--muted)"
                        tick={{ fill: 'var(--muted)', fontSize: 10 }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                        }}
                        labelFormatter={tooltipLabelFormatter}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#F59E0B"
                        fill="url(#colorTrades)"
                        name="Trades"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Forum Activity */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 mb-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span>🏛️</span> Forum Activity
              </h2>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={analyticsData.forumThreadsPerDay.map((thread, i) => ({
                      date: thread.date,
                      threads: thread.count,
                      posts: analyticsData.forumPostsPerDay[i]?.count || 0,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDateShort}
                      stroke="var(--muted)"
                      tick={{ fill: 'var(--muted)', fontSize: 10 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      stroke="var(--muted)"
                      tick={{ fill: 'var(--muted)', fontSize: 10 }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                      }}
                      labelFormatter={tooltipLabelFormatter}
                    />
                    <Line
                      type="monotone"
                      dataKey="threads"
                      stroke="#F59E0B"
                      strokeWidth={2}
                      dot={false}
                      name="Threads"
                    />
                    <Line
                      type="monotone"
                      dataKey="posts"
                      stroke="#06B6D4"
                      strokeWidth={2}
                      dot={false}
                      name="Posts"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-6 mt-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-full bg-[#F59E0B]"></span>
                  <span className="text-[var(--muted)]">Threads</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-full bg-[#06B6D4]"></span>
                  <span className="text-[var(--muted)]">Posts</span>
                </div>
              </div>
            </div>

            {/* Bottom Row */}
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Hourly Activity Heatmap */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span>🕐</span> Activity by Hour (UTC)
                </h2>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analyticsData.hourlyActivityHeatmap}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="hour"
                        stroke="var(--muted)"
                        tick={{ fill: 'var(--muted)', fontSize: 10 }}
                        tickFormatter={(h) => `${h}h`}
                      />
                      <YAxis
                        stroke="var(--muted)"
                        tick={{ fill: 'var(--muted)', fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                        }}
                        labelFormatter={(h) => `${h}:00 UTC`}
                      />
                      <Bar
                        dataKey="count"
                        fill={CHART_COLORS.quaternary}
                        radius={[2, 2, 0, 0]}
                        name="Events"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Resource Distribution */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span>💰</span> Resource Distribution
                </h2>
                <div className="h-[200px] flex items-center justify-center">
                  {getResourcePieData().length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={getResourcePieData()}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={70}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {getResourcePieData().map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                          }}
                          formatter={(value) => formatNumber(Number(value) || 0)}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-[var(--muted)]">No resource data</div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: RESOURCE_COLORS.gold }}></span>
                    <span className="text-[var(--muted)]">Gold: {formatNumber(analyticsData.resourceDistribution.totalGold)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: RESOURCE_COLORS.wood }}></span>
                    <span className="text-[var(--muted)]">Wood: {formatNumber(analyticsData.resourceDistribution.totalWood)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: RESOURCE_COLORS.food }}></span>
                    <span className="text-[var(--muted)]">Food: {formatNumber(analyticsData.resourceDistribution.totalFood)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: RESOURCE_COLORS.stone }}></span>
                    <span className="text-[var(--muted)]">Stone: {formatNumber(analyticsData.resourceDistribution.totalStone)}</span>
                  </div>
                </div>
              </div>

              {/* Top Agents by Activity */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span>🏆</span> Most Active Agents
                </h2>
                <div className="space-y-2 max-h-[240px] overflow-y-auto">
                  {analyticsData.topAgentsByActivity.length > 0 ? (
                    analyticsData.topAgentsByActivity.map((agent, index) => (
                      <div
                        key={agent.name}
                        className="flex items-center justify-between p-2 bg-[var(--background)] rounded border border-[var(--border)]/50"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[var(--muted)] text-xs w-4">#{index + 1}</span>
                          <span className="font-medium text-sm text-[var(--foreground)]">{agent.name}</span>
                        </div>
                        <span className="text-xs text-[var(--accent)]">{formatNumber(agent.eventCount)} events</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-[var(--muted)] py-4">
                      No activity data
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Back link */}
            <div className="mt-6 text-center">
              <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)] transition-colors">
                ← Back to ClawCity
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
