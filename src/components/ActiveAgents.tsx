'use client';

import { useMemo } from 'react';
import { AgentLeaderboard } from '@/lib/types';
import { CrabSprite } from './CrabSprite';
import { resolveAvatar } from '@/lib/avatar';
import { isAgentOnline } from '@/lib/presence';
import {
  type HomeLiveState,
  getHomeEmptyStateMessage,
  getHomeLiveStatusPresentation,
} from '@/lib/home-live-state';

interface ActiveAgentsProps {
  agents: AgentLeaderboard[];
  onlineCount?: number;
  onAgentClick?: (agentId: string, x: number, y: number) => void;
  liveState: HomeLiveState;
}

// Shared presence signal from world/status (with local fallback).
function isActiveAgent(agent: AgentLeaderboard): boolean {
  return isAgentOnline(agent);
}

// Format time ago
function formatTimeAgo(lastSeenAt?: string | null): string {
  if (!lastSeenAt) return 'offline';
  const now = Date.now();
  const lastActiveTime = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(lastActiveTime)) return 'offline';
  const diffMs = now - lastActiveTime;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return 'offline';
}

export function ActiveAgents({ agents, onlineCount, onAgentClick, liveState }: ActiveAgentsProps) {
  // Filter to only active agents and sort by most recently active
  const activeAgents = useMemo(() => {
    return agents
      .filter(agent => isActiveAgent(agent))
      .sort((a, b) => {
        const aTime = new Date(a.last_seen_at || a.last_active).getTime();
        const bTime = new Date(b.last_seen_at || b.last_active).getTime();
        return bTime - aTime;
      });
  }, [agents]);
  const displayedOnlineCount = typeof onlineCount === 'number' ? onlineCount : activeAgents.length;
  const lifecycle = getHomeLiveStatusPresentation(liveState);
  const headerMeta = liveState.phase === 'live'
    ? `${displayedOnlineCount} online`
    : liveState.isStaleSnapshot
      ? `${displayedOnlineCount} in snapshot`
      : lifecycle.label;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-[var(--foreground)] flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${lifecycle.dotClassName}`} aria-hidden="true" />
          Active Now
        </h3>
        <span className={`text-xs ${liveState.phase === 'live' ? 'text-[var(--muted)]' : lifecycle.textClassName}`}>
          {headerMeta}
        </span>
      </div>

      {/* Agent List */}
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {activeAgents.length > 0 ? (
          activeAgents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onAgentClick?.(agent.id, agent.x, agent.y)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--surface-alt)] transition-colors text-left group"
            >
              {/* Crab icon with avatar color background */}
              <div
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full"
                style={{ backgroundColor: resolveAvatar(agent.name, agent.avatar).body_color + '25' }}
              >
                <CrabSprite animation="idle" scale={0.8} />
              </div>

              {/* Agent info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--foreground)] truncate group-hover:text-[var(--accent)]">
                  {agent.name}
                </div>
                <div className="text-[10px] text-[var(--muted)] flex items-center gap-2">
                  <span>({agent.x}, {agent.y})</span>
                  <span className="text-green-500">{formatTimeAgo(agent.last_seen_at || agent.last_active)}</span>
                </div>
              </div>

              {/* View button */}
              <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-xs text-[var(--accent)]">View</span>
              </div>
            </button>
          ))
        ) : (
          <div className="text-center py-8 text-[var(--muted)] text-sm">
            <div className="text-2xl mb-2">😴</div>
            <p>{getHomeEmptyStateMessage('activeAgents', liveState)}</p>
            {liveState.phase !== 'live' && (
              <p className={`text-xs mt-1 ${lifecycle.textClassName}`}>{lifecycle.detail}</p>
            )}
          </div>
        )}
      </div>

      {/* Footer hint */}
      {activeAgents.length > 0 && (
        <div className="mt-2 pt-2 border-t border-[var(--border)] text-[10px] text-[var(--muted)] text-center">
          Click an agent to see their view
        </div>
      )}
    </div>
  );
}

// Export the helper function for use elsewhere
export { isActiveAgent };
