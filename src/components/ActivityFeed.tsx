'use client';

import { GameEvent } from '@/lib/types';

interface ActivityFeedProps {
  events: GameEvent[];
  maxHeight?: string;
}

function getEventIcon(type: string): string {
  switch (type) {
    case 'move': return '→';
    case 'gather': return '⛏️';
    case 'trade': return '⚖️';
    case 'speak': return '💬';
    case 'join': return '✦';
    case 'leave': return '✧';
    case 'claim': return '🏴';
    default: return '•';
  }
}

function getEventColor(type: string, data?: Record<string, unknown>): string {
  // Special case: depleted tile gather
  if (type === 'gather' && data?.tile_depleted) {
    return 'text-orange-400';
  }
  
  switch (type) {
    case 'move': return 'text-blue-400';
    case 'gather': return 'text-yellow-400';
    case 'trade': return 'text-green-400';
    case 'speak': return 'text-purple-400';
    case 'join': return 'text-[var(--accent)]';
    case 'leave': return 'text-red-400';
    case 'claim': return 'text-pink-400';
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

// Resource icons mapping
const RESOURCE_ICONS: Record<string, string> = {
  gold: '🪙',
  wood: '🪵',
  stone: '🪨',
  food: '🍎',
};

// Format gather event with resource icons
function formatGatherMessage(agentName: string, data: Record<string, unknown>): JSX.Element {
  const resources = data.resources as Record<string, number> | undefined;
  const tileDepleted = data.tile_depleted as boolean | undefined;
  
  if (!resources) {
    return <span>{agentName} gathered nothing</span>;
  }

  const gatheredItems = Object.entries(resources)
    .filter(([, amount]) => amount > 0)
    .map(([resource, amount]) => (
      <span key={resource} className="inline-flex items-center gap-0.5 mx-0.5">
        <span>{RESOURCE_ICONS[resource] || ''}</span>
        <span>{amount}</span>
      </span>
    ));

  if (gatheredItems.length === 0) {
    return <span>{agentName} gathered nothing</span>;
  }

  return (
    <span>
      <span className="font-medium">{agentName}</span> gathered {gatheredItems}
      {tileDepleted && (
        <span className="ml-1 text-orange-400 text-xs font-medium">
          [DEPLETED]
        </span>
      )}
    </span>
  );
}

// Format claim event
function formatClaimMessage(agentName: string, data: Record<string, unknown>): JSX.Element {
  const terrain = data.terrain as string || 'tile';
  const upkeepCost = data.upkeep_cost_per_day as number;
  
  return (
    <span>
      <span className="font-medium">{agentName}</span> claimed a {terrain}
      {upkeepCost && (
        <span className="text-[var(--muted)] text-xs ml-1">
          ({upkeepCost}g/day)
        </span>
      )}
    </span>
  );
}

// Format event message with enhanced rendering for gather events
function formatEventMessage(event: GameEvent): JSX.Element {
  const name = event.agent_name || 'Unknown';
  const data = event.data || {};
  
  switch (event.type) {
    case 'gather':
      return formatGatherMessage(name, data);
    
    case 'claim':
      return formatClaimMessage(name, data);
    
    case 'move':
      return <span><span className="font-medium">{name}</span> moved {data.direction as string}</span>;
    
    case 'trade':
      return (
        <span>
          <span className="font-medium">{name}</span> traded with {data.target_name as string || 'someone'}
        </span>
      );
    
    case 'speak':
      const isWhisper = data.is_whisper as boolean;
      return (
        <span className={isWhisper ? 'italic' : ''}>
          <span className="font-medium">{name}</span>
          {isWhisper ? ' whispered' : ''}: &quot;{data.message as string}&quot;
        </span>
      );
    
    case 'join':
      return <span><span className="font-medium text-[var(--accent)]">{name}</span> joined the world 🦞</span>;
    
    case 'leave':
      return <span><span className="font-medium">{name}</span> left the world</span>;
    
    default:
      return <span><span className="font-medium">{name}</span> did something</span>;
  }
}

// Calculate total value of gathered resources for highlighting
function getGatherValue(data: Record<string, unknown>): number {
  const resources = data.resources as Record<string, number> | undefined;
  if (!resources) return 0;
  
  // Use wealth formula weights
  return (
    (resources.gold || 0) * 1 +
    (resources.wood || 0) * 2 +
    (resources.stone || 0) * 3 +
    (resources.food || 0) * 1
  );
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
      {events.map((event) => {
        // Highlight big gathers (value > 10)
        const isBigGather = event.type === 'gather' && getGatherValue(event.data) > 10;
        const isDepleted = event.type === 'gather' && event.data?.tile_depleted;
        
        return (
          <div
            key={event.id}
            className={`event-item flex items-start gap-2 py-1.5 px-2 rounded hover:bg-[var(--surface)] transition-colors ${
              isBigGather ? 'bg-yellow-400/10 border-l-2 border-yellow-400' : ''
            } ${
              isDepleted ? 'bg-orange-400/10' : ''
            }`}
          >
            {/* Event icon */}
            <span className={`${getEventColor(event.type, event.data)} flex-shrink-0`}>
              {getEventIcon(event.type)}
            </span>
            
            {/* Event content */}
            <div className="flex-1 min-w-0">
              <p className="text-sm break-words">
                {formatEventMessage(event)}
              </p>
              
              {/* Location and time */}
              <div className="flex items-center gap-2 text-[10px] text-[var(--muted)] mt-0.5">
                <span>
                  ({event.location?.x ?? '?'}, {event.location?.y ?? '?'})
                </span>
                <span>•</span>
                <span>{formatTimestamp(event.created_at)}</span>
                {isBigGather && (
                  <>
                    <span>•</span>
                    <span className="text-yellow-400">Big haul!</span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
