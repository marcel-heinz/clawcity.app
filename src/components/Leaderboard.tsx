'use client';

import { AgentPublic } from '@/lib/types';

interface LeaderboardProps {
  agents: AgentPublic[];
  maxDisplay?: number;
}

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

export function Leaderboard({ agents, maxDisplay = 15 }: LeaderboardProps) {
  // Sort by reputation
  const sortedAgents = [...agents]
    .sort((a, b) => b.reputation - a.reputation)
    .slice(0, maxDisplay);

  if (sortedAgents.length === 0) {
    return (
      <div className="text-[var(--muted)] text-center py-4">
        No agents yet
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {sortedAgents.map((agent, index) => (
        <div
          key={agent.id}
          className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--surface)] transition-colors"
        >
          {/* Rank */}
          <span className={`w-5 text-right text-sm ${
            index === 0 ? 'text-yellow-400' :
            index === 1 ? 'text-gray-300' :
            index === 2 ? 'text-orange-400' :
            'text-[var(--muted)]'
          }`}>
            {index + 1}.
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
          
          {/* Reputation */}
          <span className="text-[var(--accent)] text-sm font-medium">
            {agent.reputation}
          </span>
        </div>
      ))}
    </div>
  );
}
