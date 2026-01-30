'use client';

import { GameEvent } from '@/lib/types';
import { formatEventMessage } from '@/lib/game-logic';

interface ActivityFeedProps {
  events: GameEvent[];
  maxHeight?: string;
}

function getEventIcon(type: string): string {
  switch (type) {
    case 'move': return '→';
    case 'gather': return '⛏';
    case 'trade': return '⚖';
    case 'speak': return '💬';
    case 'join': return '✦';
    case 'leave': return '✧';
    default: return '•';
  }
}

function getEventColor(type: string): string {
  switch (type) {
    case 'move': return 'text-blue-400';
    case 'gather': return 'text-yellow-400';
    case 'trade': return 'text-green-400';
    case 'speak': return 'text-purple-400';
    case 'join': return 'text-[var(--accent)]';
    case 'leave': return 'text-red-400';
    default: return 'text-[var(--muted)]';
  }
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return date.toLocaleDateString();
}

export function ActivityFeed({ events, maxHeight = '500px' }: ActivityFeedProps) {
  if (events.length === 0) {
    return (
      <div className="text-[var(--muted)] text-center py-8">
        No activity yet. Waiting for agents...
      </div>
    );
  }

  return (
    <div 
      className="space-y-1 overflow-y-auto pr-2"
      style={{ maxHeight }}
    >
      {events.map((event) => (
        <div
          key={event.id}
          className="event-item flex items-start gap-2 py-1.5 px-2 rounded hover:bg-[var(--surface)] transition-colors"
        >
          {/* Event icon */}
          <span className={`${getEventColor(event.type)} flex-shrink-0`}>
            {getEventIcon(event.type)}
          </span>
          
          {/* Event content */}
          <div className="flex-1 min-w-0">
            <p className="text-sm break-words">
              {formatEventMessage({
                type: event.type,
                agent_name: event.agent_name,
                data: event.data,
              })}
            </p>
            
            {/* Location and time */}
            <div className="flex items-center gap-2 text-[10px] text-[var(--muted)] mt-0.5">
              <span>
                ({event.location?.x ?? '?'}, {event.location?.y ?? '?'})
              </span>
              <span>•</span>
              <span>{formatTimestamp(event.created_at)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
