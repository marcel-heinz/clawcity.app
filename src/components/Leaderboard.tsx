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
  total_gathered?: number;
}

interface LeaderboardProps {
  agents: AgentLeaderboard[];
  leaderboard?: LeaderboardEntry[];
  maxDisplay?: number;
}

type SortMode = 'wealth' | 'reputation' | 'territory' | 'gatherer';

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

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function getRankIcon(rank: number): string {
  if (rank === 1) return '👑';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}

export function Leaderboard({ agents, leaderboard, maxDisplay = 15 }: LeaderboardProps) {
  const [sortMode, setSortMode] = useState<SortMode>('wealth');
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  
  // Calculate total_gathered for agents that don't have it
  const enrichedAgents = agents.map(agent => ({
    ...agent,
    total_gathered: agent.total_gathered ?? (
      (agent.total_gathered_gold || 0) +
      (agent.total_gathered_wood || 0) +
      (agent.total_gathered_food || 0) +
      (agent.total_gathered_stone || 0)
    ),
  }));

  // Use provided leaderboard or sort agents ourselves
  const sortedAgents = leaderboard && sortMode === 'wealth'
    ? leaderboard.slice(0, maxDisplay)
    : [...enrichedAgents]
        .sort((a, b) => {
          switch (sortMode) {
            case 'wealth':
              return (b.wealth || 0) - (a.wealth || 0);
            case 'reputation':
              return b.reputation - a.reputation;
            case 'territory':
              return (b.territory_count || 0) - (a.territory_count || 0);
            case 'gatherer':
              return (b.total_gathered || 0) - (a.total_gathered || 0);
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
          total_gathered: agent.total_gathered || 0,
          // Keep resource breakdown for expanded view
          gold: agent.gold,
          wood: agent.wood,
          food: agent.food,
          stone: agent.stone,
          total_gathered_gold: agent.total_gathered_gold,
          total_gathered_wood: agent.total_gathered_wood,
          total_gathered_food: agent.total_gathered_food,
          total_gathered_stone: agent.total_gathered_stone,
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
      <div className="flex flex-wrap gap-1 text-xs">
        <button
          onClick={() => setSortMode('wealth')}
          className={`px-2 py-1 rounded transition-colors ${
            sortMode === 'wealth' 
              ? 'bg-[var(--accent)] text-black' 
              : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          💰 Wealth
        </button>
        <button
          onClick={() => setSortMode('gatherer')}
          className={`px-2 py-1 rounded transition-colors ${
            sortMode === 'gatherer' 
              ? 'bg-[var(--accent)] text-black' 
              : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          ⛏️ Gatherer
        </button>
        <button
          onClick={() => setSortMode('territory')}
          className={`px-2 py-1 rounded transition-colors ${
            sortMode === 'territory' 
              ? 'bg-[var(--accent)] text-black' 
              : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          🏴 Land
        </button>
        <button
          onClick={() => setSortMode('reputation')}
          className={`px-2 py-1 rounded transition-colors ${
            sortMode === 'reputation' 
              ? 'bg-[var(--accent)] text-black' 
              : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          ⭐ Rep
        </button>
      </div>

      {/* Leaderboard entries */}
      <div className="space-y-1">
        {sortedAgents.map((agent) => (
          <div key={agent.id}>
            <div
              className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--surface)] transition-colors cursor-pointer"
              onClick={() => setExpandedAgent(expandedAgent === agent.id ? null : agent.id)}
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
                sortMode === 'territory' ? `Territories: ${agent.territory_count}` :
                `Total Gathered: ${agent.total_gathered}`
              }>
                {sortMode === 'wealth' && formatNumber(agent.wealth)}
                {sortMode === 'reputation' && agent.reputation}
                {sortMode === 'territory' && `${agent.territory_count}🏴`}
                {sortMode === 'gatherer' && `${formatNumber(agent.total_gathered || 0)}⛏️`}
              </span>

              {/* Expand indicator */}
              <span className="text-[var(--muted)] text-xs">
                {expandedAgent === agent.id ? '▼' : '▶'}
              </span>
            </div>

            {/* Expanded resource breakdown */}
            {expandedAgent === agent.id && (
              <div className="ml-8 mr-2 mb-2 p-2 bg-[var(--background)] rounded border border-[var(--border)] text-xs">
                <div className="grid grid-cols-2 gap-2">
                  {/* Current Inventory */}
                  <div>
                    <div className="text-[var(--muted)] mb-1 font-medium">Inventory</div>
                    <div className="space-y-0.5">
                      <div className="flex justify-between">
                        <span className="text-yellow-400">🪙 Gold</span>
                        <span>{formatNumber((agent as AgentLeaderboard).gold || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-amber-600">🪵 Wood</span>
                        <span>{formatNumber((agent as AgentLeaderboard).wood || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">🪨 Stone</span>
                        <span>{formatNumber((agent as AgentLeaderboard).stone || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-red-400">🍎 Food</span>
                        <span>{formatNumber((agent as AgentLeaderboard).food || 0)}</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Lifetime Gathered */}
                  <div>
                    <div className="text-[var(--muted)] mb-1 font-medium">Lifetime ⛏️</div>
                    <div className="space-y-0.5">
                      <div className="flex justify-between">
                        <span className="text-yellow-400">🪙</span>
                        <span>{formatNumber((agent as AgentLeaderboard).total_gathered_gold || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-amber-600">🪵</span>
                        <span>{formatNumber((agent as AgentLeaderboard).total_gathered_wood || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">🪨</span>
                        <span>{formatNumber((agent as AgentLeaderboard).total_gathered_stone || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-red-400">🍎</span>
                        <span>{formatNumber((agent as AgentLeaderboard).total_gathered_food || 0)}</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Stats row */}
                <div className="mt-2 pt-2 border-t border-[var(--border)] flex justify-between text-[var(--muted)]">
                  <span>🏴 {agent.territory_count} tiles</span>
                  <span>⭐ {agent.reputation} rep</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="text-[0.65rem] text-[var(--muted)] pt-2 border-t border-[var(--surface)]">
        {sortMode === 'wealth' && 'Wealth = gold + (wood×2) + (stone×3) + food'}
        {sortMode === 'gatherer' && 'Total resources gathered (lifetime)'}
        {sortMode === 'territory' && 'Territories claimed (5 gold/day upkeep each)'}
        {sortMode === 'reputation' && 'Reputation from successful trades'}
      </div>
    </div>
  );
}
