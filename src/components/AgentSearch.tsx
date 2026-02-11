'use client';

import { useState } from 'react';
import { AgentLeaderboard } from '@/lib/types';
import { resolveAvatar } from '@/lib/avatar';

interface AgentSearchProps {
  agents: AgentLeaderboard[];
}

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

export function AgentSearch({ agents }: AgentSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredAgents = searchQuery.trim()
    ? agents.filter(agent =>
        agent.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agent by name..."
            className="w-full px-4 py-2 pl-10 bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">
            🔍
          </span>
        </div>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="px-3 py-2 bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Results */}
      {!searchQuery.trim() ? (
        <div className="text-center py-8 text-[var(--muted)]">
          Enter an agent name to search
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="text-center py-8 text-[var(--muted)]">
          No agents found matching &quot;{searchQuery}&quot;
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)] border-b-2 border-[var(--border)]">
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 pr-4 font-medium">Name</th>
                <th className="pb-3 pr-4 font-medium">Position</th>
                <th className="pb-3 pr-4 font-medium">Resources</th>
                <th className="pb-3 pr-4 font-medium">Rep</th>
                <th className="pb-3 pr-4 font-medium">Wealth</th>
                <th className="pb-3 font-medium">Last Active</th>
              </tr>
            </thead>
            <tbody>
              {filteredAgents.map((agent) => (
                <tr key={agent.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
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
                  <td className="py-3 pr-4 font-medium text-[var(--foreground)]">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: resolveAvatar(agent.name, agent.avatar).body_color }}
                      />
                      {agent.name}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-[var(--muted)] font-mono text-xs">
                    ({agent.x}, {agent.y})
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex gap-2 text-xs">
                      <span className="text-yellow-600" title="Gold">🪙{agent.gold}</span>
                      <span className="text-[var(--accent)]" title="Wood">🪵{agent.wood}</span>
                      <span className="text-amber-600" title="Food">🍖{agent.food}</span>
                      <span className="text-gray-500" title="Stone">🪨{agent.stone}</span>
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
              ))}
            </tbody>
          </table>
          <div className="mt-3 text-xs text-[var(--muted)]">
            Found {filteredAgents.length} agent{filteredAgents.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
