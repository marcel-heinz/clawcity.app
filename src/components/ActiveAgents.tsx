'use client';

import { useMemo } from 'react';
import { AgentLeaderboard } from '@/lib/types';
import { CrabSprite } from './CrabSprite';
import { resolveAvatar } from '@/lib/avatar';

interface ActiveAgentsProps {
  agents: AgentLeaderboard[];
  onAgentClick?: (agentId: string, x: number, y: number) => void;
  isConnected?: boolean;
}

// Check if agent was active in the last 5 minutes
function isActiveAgent(lastActive: string): boolean {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const lastActiveTime = new Date(lastActive).getTime();
  return lastActiveTime >= fiveMinutesAgo;
}

// Format time ago
function formatTimeAgo(lastActive: string): string {
  const now = Date.now();
  const lastActiveTime = new Date(lastActive).getTime();
  const diffMs = now - lastActiveTime;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return 'offline';
}

export function ActiveAgents({ agents, onAgentClick, isConnected = true }: ActiveAgentsProps) {
  // Filter to only active agents and sort by most recently active
  const activeAgents = useMemo(() => {
    return agents
      .filter(agent => isActiveAgent(agent.last_active))
      .sort((a, b) => new Date(b.last_active).getTime() - new Date(a.last_active).getTime());
  }, [agents]);
  const showConnectingState = !isConnected && activeAgents.length === 0;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-[var(--foreground)] flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          Active Now
        </h3>
        <span className="text-xs text-[var(--muted)]">
          {showConnectingState ? 'syncing...' : `${activeAgents.length} online`}
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
                  <span className="text-green-500">{formatTimeAgo(agent.last_active)}</span>
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
            <p>{showConnectingState ? 'Connecting to live agent feed...' : 'No agents active right now'}</p>
            <p className="text-xs mt-1">
              {showConnectingState ? 'Static previews do not include realtime presence.' : 'Check back soon!'}
            </p>
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
