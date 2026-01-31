'use client';

import { useState } from 'react';
import { AgentLeaderboard } from '@/lib/types';

interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  wealth: number;
  reputation: number;
  territory_count: number;
  last_active: string;
}

interface RecentlyJoinedEntry {
  id: string;
  name: string;
}

interface LeaderboardProps {
  agents: AgentLeaderboard[];
  leaderboard?: LeaderboardEntry[];
  recentlyJoined?: RecentlyJoinedEntry[];
  maxDisplay?: number;
}

type SortMode = 'wealth' | 'reputation' | 'territory';

function formatLastActive(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'online';
  if (diffMin < 5) return 'active';
  if (diffMin < 60) return `${diffMin}m`;
  return 'offline';
}

function getStatusColor(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 5) return 'bg-[var(--accent)]';
  if (diffMin < 30) return 'bg-yellow-500';
  return 'bg-[var(--muted)]';
}

function formatWealth(wealth: number): string {
  if (wealth >= 1000000) return `${(wealth / 1000000).toFixed(1)}M`;
  if (wealth >= 1000) return `${(wealth / 1000).toFixed(1)}K`;
  return wealth.toString();
}

function getRankIcon(rank: number): string {
  if (rank === 1) return '👑';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}

export function Leaderboard({ agents, leaderboard, recentlyJoined, maxDisplay = 15 }: LeaderboardProps) {
  const [sortMode, setSortMode] = useState<SortMode>('wealth');
  
  // Use provided leaderboard or sort agents ourselves
  const sortedAgents = leaderboard 
    ? leaderboard.slice(0, maxDisplay)
    : [...agents]
        .sort((a, b) => {
          switch (sortMode) {
            case 'wealth':
              return (b.wealth || 0) - (a.wealth || 0);
            case 'reputation':
              return b.reputation - a.reputation;
            case 'territory':
              return (b.territory_count || 0) - (a.territory_count || 0);
            default:
              return (b.wealth || 0) - (a.wealth || 0);
          }
        })
        .slice(0, maxDisplay)
        .map((agent, index) => ({
          rank: index + 1,
          id: agent.id,
          name: agent.name,
          wealth: agent.wealth || 0,
          reputation: agent.reputation,
          territory_count: agent.territory_count || 0,
          last_active: agent.last_active,
        }));

  if (sortedAgents.length === 0) {
    return (
      <div className="text-[var(--muted)] text-center py-4">
        No agents yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Sort toggle */}
      <div className="flex gap-1 text-xs">
        <button
          onClick={() => setSortMode('wealth')}
          className={`px-2 py-1 rounded transition-colors ${
            sortMode === 'wealth' 
              ? 'bg-[var(--accent)] text-black' 
              : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          Wealth
        </button>
        <button
          onClick={() => setSortMode('reputation')}
          className={`px-2 py-1 rounded transition-colors ${
            sortMode === 'reputation' 
              ? 'bg-[var(--accent)] text-black' 
              : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          Rep
        </button>
        <button
          onClick={() => setSortMode('territory')}
          className={`px-2 py-1 rounded transition-colors ${
            sortMode === 'territory' 
              ? 'bg-[var(--accent)] text-black' 
              : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          Land
        </button>
      </div>

      {/* Leaderboard entries */}
      <div className="space-y-1">
        {sortedAgents.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--surface)] transition-colors"
          >
            {/* Rank */}
            <span className={`w-6 text-right text-sm ${
              agent.rank === 1 ? 'text-yellow-400' :
              agent.rank === 2 ? 'text-gray-300' :
              agent.rank === 3 ? 'text-orange-400' :
              'text-[var(--muted)]'
            }`}>
              {getRankIcon(agent.rank) || `${agent.rank}.`}
            </span>
            
            {/* Status indicator */}
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusColor(agent.last_active)}`}
              title={formatLastActive(agent.last_active)}
            />
            
            {/* Name */}
            <span className="flex-1 truncate text-sm" title={agent.name}>
              {agent.name}
            </span>
            
            {/* Primary stat based on sort mode */}
            <span className="text-[var(--accent)] text-sm font-medium min-w-[3rem] text-right" title={
              sortMode === 'wealth' ? `Wealth: ${agent.wealth}` :
              sortMode === 'reputation' ? `Reputation: ${agent.reputation}` :
              `Territories: ${agent.territory_count}`
            }>
              {sortMode === 'wealth' && formatWealth(agent.wealth)}
              {sortMode === 'reputation' && agent.reputation}
              {sortMode === 'territory' && `${agent.territory_count}🏴`}
            </span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="text-[0.65rem] text-[var(--muted)] pt-2 border-t border-[var(--surface)]">
        Wealth = gold + (wood×2) + (stone×3) + food
      </div>

      {/* Recently Joined */}
      {recentlyJoined && recentlyJoined.length > 0 && (
        <div className="pt-3 mt-3 border-t border-[var(--surface)]">
          <h3 className="text-xs text-[var(--muted)] mb-2">Recently Joined</h3>
          <div className="space-y-1">
            {recentlyJoined.map((agent) => (
              <div
                key={agent.id}
                className="text-sm text-[var(--foreground)] truncate"
              >
                {agent.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
