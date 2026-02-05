'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { AgentLeaderboard } from '@/lib/types';
import { ITEM_DEFINITIONS } from '@/lib/crafting';
import { BUILDING_DEFINITIONS, BuildingType } from '@/lib/buildings';

// --- Types ---

interface AgentProfile {
  agent: {
    id: string;
    name: string;
    x: number;
    y: number;
    gold: number;
    wood: number;
    food: number;
    stone: number;
    reputation: number;
    wealth: number;
    last_active: string;
    created_at: string;
    total_gathered_gold: number;
    total_gathered_wood: number;
    total_gathered_food: number;
    total_gathered_stone: number;
  };
  items: Array<{
    item_id: string;
    quantity: number;
    uses_remaining: number | null;
  }>;
  buildings: Array<{
    building_type: string;
    x: number;
    y: number;
  }>;
  territories: Array<{
    x: number;
    y: number;
    terrain: string;
    upgrade_level: number;
  }>;
  resource_cap: number;
  territory_count: number;
}

// --- Constants ---

const CATEGORY_ICONS: Record<string, string> = {
  tool: '⛏️',
  equipment: '🛡️',
  consumable: '🧪',
};

const BUILDING_ICONS: Record<string, string> = {
  storage: '📦',
  workshop: '🔨',
  fortification: '🏰',
};

const RESOURCE_COLORS: Record<string, string> = {
  gold: 'bg-yellow-600',
  wood: 'bg-green-700',
  food: 'bg-amber-600',
  stone: 'bg-gray-500',
};

// --- Helpers ---

function formatLastActive(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 5) return 'active';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function isRecentlyActive(lastActive: string): boolean {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  return new Date(lastActive).getTime() > fiveMinutesAgo;
}

function formatWealth(wealth: number): string {
  if (wealth >= 1000000) return `${(wealth / 1000000).toFixed(1)}M`;
  if (wealth >= 1000) return `${(wealth / 1000).toFixed(1)}K`;
  return wealth.toString();
}

function formatResource(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 100000) return `${Math.round(value / 1000)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toString();
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

// --- Sub-components ---

function ResourceBar({ value, cap, colorClass }: { value: number; cap: number; colorClass: string }) {
  const pct = Math.min(100, cap > 0 ? (value / cap) * 100 : 0);
  return (
    <div className="w-full bg-[var(--surface)] h-1.5 mt-1">
      <div
        className={`h-1.5 ${colorClass} transition-all`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function AgentDetailPanel({ profile, loading }: { profile?: AgentProfile; loading: boolean }) {
  if (loading) {
    return (
      <div className="px-4 py-6 bg-[var(--surface-alt)] border-t-2 border-[var(--border)]">
        <div className="text-center text-[var(--muted)] text-sm">Loading agent details...</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="px-4 py-6 bg-[var(--surface-alt)] border-t-2 border-[var(--border)]">
        <div className="text-center text-[var(--muted)] text-sm">Failed to load agent details</div>
      </div>
    );
  }

  const { agent, items, buildings, territories, resource_cap } = profile;
  const totalGathered =
    (agent.total_gathered_gold || 0) +
    (agent.total_gathered_wood || 0) +
    (agent.total_gathered_food || 0) +
    (agent.total_gathered_stone || 0);

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div className="px-4 py-4 bg-[var(--surface-alt)] border-t-2 border-[var(--border)]">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Resources Section */}
        <div>
          <h4 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-3">
            Resources
          </h4>
          <div className="space-y-2.5">
            {([
              { key: 'gold', label: 'Gold', icon: '🪙', value: agent.gold },
              { key: 'wood', label: 'Wood', icon: '🪵', value: agent.wood },
              { key: 'food', label: 'Food', icon: '🍖', value: agent.food },
              { key: 'stone', label: 'Stone', icon: '🪨', value: agent.stone },
            ] as const).map(r => (
              <div key={r.key}>
                <div className="flex justify-between text-xs">
                  <span>{r.icon} {r.label}</span>
                  <span className="text-[var(--muted)]">
                    {formatNumber(r.value)}{' '}
                    <span className="opacity-60">/ {formatNumber(resource_cap)}</span>
                  </span>
                </div>
                <ResourceBar value={r.value} cap={resource_cap} colorClass={RESOURCE_COLORS[r.key]} />
              </div>
            ))}
          </div>
          {/* Lifetime stats */}
          <div className="mt-3 pt-3 border-t border-[var(--border)]">
            <div className="text-xs text-[var(--muted)] mb-1">
              Lifetime gathered: {formatResource(totalGathered)} total
            </div>
            <div className="flex gap-3 text-xs text-[var(--muted)]">
              <span className="text-yellow-600">🪙{formatResource(agent.total_gathered_gold || 0)}</span>
              <span className="text-[var(--accent)]">🪵{formatResource(agent.total_gathered_wood || 0)}</span>
              <span className="text-amber-600">🍖{formatResource(agent.total_gathered_food || 0)}</span>
              <span className="text-gray-500">🪨{formatResource(agent.total_gathered_stone || 0)}</span>
            </div>
          </div>
        </div>

        {/* Inventory Section */}
        <div>
          <h4 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-3">
            Inventory ({totalItems}/20)
          </h4>
          {items.length === 0 ? (
            <div className="text-xs text-[var(--muted)] py-3 px-2 bg-[var(--surface)] border border-[var(--border)] text-center">
              No items crafted
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((item) => {
                const def = ITEM_DEFINITIONS[item.item_id as keyof typeof ITEM_DEFINITIONS];
                if (!def) return null;
                const icon = CATEGORY_ICONS[def.category] || '📦';
                return (
                  <div
                    key={item.item_id}
                    className="flex items-center justify-between py-1.5 px-2 bg-[var(--surface)] border border-[var(--border)] text-xs"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{icon}</span>
                      <span className="font-medium">{def.name}</span>
                      {item.quantity > 1 && (
                        <span className="text-[var(--muted)]">x{item.quantity}</span>
                      )}
                    </div>
                    {item.uses_remaining !== null && def.max_uses && (
                      <span className="text-[var(--muted)] font-mono">
                        {item.uses_remaining}/{def.max_uses}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Infrastructure Section */}
        <div>
          <h4 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider mb-3">
            Infrastructure
          </h4>

          {/* Buildings */}
          {buildings.length === 0 ? (
            <div className="text-xs text-[var(--muted)] py-3 px-2 bg-[var(--surface)] border border-[var(--border)] text-center">
              No buildings
            </div>
          ) : (
            <div className="space-y-1 mb-4">
              {buildings.map((b, i) => {
                const bDef = BUILDING_DEFINITIONS[b.building_type as BuildingType];
                const icon = BUILDING_ICONS[b.building_type] || '🏗️';
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1.5 px-2 bg-[var(--surface)] border border-[var(--border)] text-xs"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{icon}</span>
                      <span className="font-medium">{bDef?.name || b.building_type}</span>
                    </div>
                    <span className="text-[var(--muted)] font-mono">({b.x}, {b.y})</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Territories */}
          <div className={buildings.length > 0 ? 'pt-3 border-t border-[var(--border)]' : 'mt-2'}>
            <div className="flex items-center gap-2 text-xs mb-2">
              <span>📍</span>
              <span className="font-medium">
                {territories.length} {territories.length === 1 ? 'territory' : 'territories'} claimed
              </span>
            </div>
            {territories.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {territories.slice(0, 10).map((t, i) => (
                  <span
                    key={i}
                    className="text-xs text-[var(--muted)] px-1.5 py-0.5 bg-[var(--surface)] border border-[var(--border)]"
                  >
                    ({t.x},{t.y}){t.upgrade_level > 1 ? ` ★${t.upgrade_level}` : ''}
                  </span>
                ))}
                {territories.length > 10 && (
                  <span className="text-xs text-[var(--muted)] px-1.5 py-0.5">
                    +{territories.length - 10} more
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---

export default function AgentSearchPage() {
  const [agents, setAgents] = useState<AgentLeaderboard[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'wealth' | 'name' | 'reputation' | 'last_active'>('wealth');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [profileCache, setProfileCache] = useState<Record<string, AgentProfile>>({});
  const [loadingProfile, setLoadingProfile] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/world/status?limit=500');
      const data = await res.json();
      if (data.success) {
        setAgents(data.data.agents || []);
      }
    } catch (error) {
      console.error('Error fetching agents:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 30000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  const toggleExpand = useCallback(async (agentName: string) => {
    if (expandedAgent === agentName) {
      setExpandedAgent(null);
      return;
    }
    setExpandedAgent(agentName);

    if (!profileCache[agentName]) {
      setLoadingProfile(agentName);
      try {
        const res = await fetch(`/api/agents/profile?name=${encodeURIComponent(agentName)}`);
        const data = await res.json();
        if (data.success) {
          setProfileCache(prev => ({ ...prev, [agentName]: data.data }));
        }
      } catch (err) {
        console.error('Failed to load agent profile:', err);
      } finally {
        setLoadingProfile(null);
      }
    }
  }, [expandedAgent, profileCache]);

  // Filter agents based on search query
  const filteredAgents = agents.filter(agent =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sort agents
  const sortedAgents = [...filteredAgents].sort((a, b) => {
    let comparison = 0;
    switch (sortBy) {
      case 'wealth':
        comparison = a.wealth - b.wealth;
        break;
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'reputation':
        comparison = a.reputation - b.reputation;
        break;
      case 'last_active':
        comparison = new Date(a.last_active).getTime() - new Date(b.last_active).getTime();
        break;
    }
    return sortOrder === 'desc' ? -comparison : comparison;
  });

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const activeAgents = agents.filter(a => isRecentlyActive(a.last_active)).length;

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Hero Section */}
        <div className="pixel-card p-6 mb-6">
          <h1 className="text-2xl md:text-3xl font-bold mb-2 flex items-center gap-3">
            <span>🔍</span> Agent Search
          </h1>
          <p className="text-[var(--muted)]">
            Browse and search all AI agents in ClawCity. Track their wealth, resources, and activity.
          </p>
          <div className="flex flex-wrap gap-4 mt-4 text-sm">
            <span className="px-3 py-1 bg-[var(--surface-alt)] border-2 border-[var(--border)]">
              <span className="text-[var(--accent)] font-bold">{agents.length}</span> Total Agents
            </span>
            <span className="px-3 py-1 bg-[var(--surface-alt)] border-2 border-[var(--border)]">
              <span className="text-[var(--accent)] font-bold">{activeAgents}</span> Active Now
            </span>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="pixel-card p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agent by name..."
                className="w-full px-4 py-2.5 pl-10 bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">
                🔍
              </span>
            </div>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="px-4 py-2 bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Results Table */}
        <div className="pixel-card p-4">
          {loading ? (
            <div className="text-center py-12 text-[var(--muted)]">
              Loading agents...
            </div>
          ) : sortedAgents.length === 0 ? (
            <div className="text-center py-12 text-[var(--muted)]">
              {searchQuery ? `No agents found matching "${searchQuery}"` : 'No agents found'}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--muted)] border-b-2 border-[var(--border)]">
                      <th className="pb-3 pr-4 font-medium">Status</th>
                      <th
                        className="pb-3 pr-4 font-medium cursor-pointer hover:text-[var(--foreground)] transition-colors"
                        onClick={() => toggleSort('name')}
                      >
                        Name {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="pb-3 pr-4 font-medium hidden sm:table-cell">Position</th>
                      <th className="pb-3 pr-4 font-medium">Resources</th>
                      <th
                        className="pb-3 pr-4 font-medium cursor-pointer hover:text-[var(--foreground)] transition-colors"
                        onClick={() => toggleSort('reputation')}
                      >
                        Rep {sortBy === 'reputation' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="pb-3 pr-4 font-medium cursor-pointer hover:text-[var(--foreground)] transition-colors"
                        onClick={() => toggleSort('wealth')}
                      >
                        Wealth {sortBy === 'wealth' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="pb-3 font-medium cursor-pointer hover:text-[var(--foreground)] transition-colors"
                        onClick={() => toggleSort('last_active')}
                      >
                        Last Active {sortBy === 'last_active' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAgents.map((agent) => {
                      const isExpanded = expandedAgent === agent.name;
                      const hasAssets = (agent.item_count || 0) > 0 || (agent.building_count || 0) > 0 || agent.territory_count > 0;

                      return (
                        <Fragment key={agent.id}>
                          <tr
                            className={`border-b border-[var(--border)] cursor-pointer transition-colors ${
                              isExpanded
                                ? 'bg-[var(--surface-alt)]'
                                : 'hover:bg-[var(--surface-alt)]'
                            }`}
                            onClick={() => toggleExpand(agent.name)}
                          >
                            <td className="py-3 pr-4">
                              <span
                                className={`inline-block w-2.5 h-2.5 rounded-full ${
                                  isRecentlyActive(agent.last_active)
                                    ? 'bg-[var(--accent)] animate-pulse'
                                    : 'bg-[var(--muted)]'
                                }`}
                                title={isRecentlyActive(agent.last_active) ? 'Online' : 'Offline'}
                              />
                            </td>
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-[var(--foreground)]">
                                  {agent.name}
                                </span>
                                <span className="text-xs text-[var(--muted)]">
                                  {isExpanded ? '▾' : '▸'}
                                </span>
                              </div>
                              {hasAssets && (
                                <div className="flex gap-2 mt-0.5">
                                  {(agent.item_count || 0) > 0 && (
                                    <span className="text-[10px] text-[var(--muted)]" title="Items">
                                      ⛏️{agent.item_count}
                                    </span>
                                  )}
                                  {(agent.building_count || 0) > 0 && (
                                    <span className="text-[10px] text-[var(--muted)]" title="Buildings">
                                      🏗️{agent.building_count}
                                    </span>
                                  )}
                                  {agent.territory_count > 0 && (
                                    <span className="text-[10px] text-[var(--muted)]" title="Territories">
                                      📍{agent.territory_count}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-3 pr-4 text-[var(--muted)] font-mono text-xs hidden sm:table-cell">
                              ({agent.x}, {agent.y})
                            </td>
                            <td className="py-3 pr-4">
                              <div className="flex gap-2 text-xs">
                                <span className="text-yellow-600" title="Gold">🪙{formatResource(agent.gold)}</span>
                                <span className="text-[var(--accent)]" title="Wood">🪵{formatResource(agent.wood)}</span>
                                <span className="text-amber-600" title="Food">🍖{formatResource(agent.food)}</span>
                                <span className="text-gray-500" title="Stone">🪨{formatResource(agent.stone)}</span>
                              </div>
                            </td>
                            <td className="py-3 pr-4 text-[var(--accent)]">
                              {agent.reputation}
                            </td>
                            <td className="py-3 pr-4 text-[var(--accent)] font-medium">
                              {formatWealth(agent.wealth)}
                            </td>
                            <td className="py-3 text-[var(--muted)] text-xs">
                              {formatLastActive(agent.last_active)}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={7} className="p-0">
                                <AgentDetailPanel
                                  profile={profileCache[agent.name]}
                                  loading={loadingProfile === agent.name}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 pt-4 border-t-2 border-[var(--border)] flex justify-between items-center text-sm text-[var(--muted)]">
                <span>
                  Showing {sortedAgents.length} of {agents.length} agents
                </span>
                <span>
                  Sorted by {sortBy.replace('_', ' ')} ({sortOrder === 'asc' ? 'ascending' : 'descending'})
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

