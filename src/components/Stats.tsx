'use client';

interface StatsProps {
  totalAgents: number;
  activeAgents: number;
  totalTrades: number;
  totalTerritories?: number;
  totalResources?: {
    gold: number;
    wood: number;
    food: number;
    stone: number;
  };
  miningActivityLastHour?: number;
  topGatherer?: string | null;
  isConnected: boolean;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

export function Stats({ 
  totalAgents, 
  activeAgents, 
  totalTrades, 
  totalTerritories = 0, 
  totalResources,
  miningActivityLastHour = 0,
  topGatherer,
  isConnected 
}: StatsProps) {
  const totalResourceValue = totalResources 
    ? totalResources.gold + totalResources.wood + totalResources.food + totalResources.stone
    : 0;

  return (
    <div className="space-y-3">
      {/* Connection status */}
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`w-2 h-2 rounded-full ${
            isConnected ? 'bg-[var(--accent)] animate-pulse' : 'bg-red-500'
          }`}
        />
        <span className={isConnected ? 'text-[var(--accent)]' : 'text-red-500'}>
          {isConnected ? 'Live' : 'Disconnected'}
        </span>
      </div>

      {/* Stats cards - 2x2 grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[var(--surface)] rounded p-3 border border-[var(--border)]">
          <div className="text-2xl font-bold text-[var(--accent)]">
            {totalAgents}
          </div>
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
            Total Agents
          </div>
        </div>

        <div className="bg-[var(--surface)] rounded p-3 border border-[var(--border)]">
          <div className="text-2xl font-bold text-green-400">
            {activeAgents}
          </div>
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
            Active Now
          </div>
        </div>

        <div className="bg-[var(--surface)] rounded p-3 border border-[var(--border)]">
          <div className="text-2xl font-bold text-yellow-400">
            {totalTrades}
          </div>
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
            Trades
          </div>
        </div>

        <div className="bg-[var(--surface)] rounded p-3 border border-[var(--border)]">
          <div className="text-2xl font-bold text-purple-400">
            {totalTerritories}
          </div>
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
            Territories
          </div>
        </div>
      </div>

      {/* Resource Economy Section */}
      <div className="border-t border-[var(--border)] pt-3">
        <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider mb-2">
          World Economy
        </div>
        
        {/* Total Resources */}
        <div className="bg-[var(--surface)] rounded p-3 border border-[var(--border)] mb-2">
          <div className="text-lg font-bold text-orange-400">
            {formatNumber(totalResourceValue)}
          </div>
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
            Total Resources
          </div>
          {totalResources && (
            <div className="flex flex-wrap gap-2 mt-2 text-[10px]">
              <span className="text-yellow-400">🪙 {formatNumber(totalResources.gold)}</span>
              <span className="text-amber-600">🪵 {formatNumber(totalResources.wood)}</span>
              <span className="text-gray-400">🪨 {formatNumber(totalResources.stone)}</span>
              <span className="text-red-400">🍎 {formatNumber(totalResources.food)}</span>
            </div>
          )}
        </div>

        {/* Mining Activity */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-[var(--surface)] rounded p-2 border border-[var(--border)]">
            <div className="text-lg font-bold text-cyan-400">
              {miningActivityLastHour}
            </div>
            <div className="text-[9px] text-[var(--muted)] uppercase tracking-wider">
              Gathers (1h)
            </div>
          </div>

          <div className="bg-[var(--surface)] rounded p-2 border border-[var(--border)]">
            <div className="text-sm font-bold text-pink-400 truncate" title={topGatherer || 'None'}>
              {topGatherer || '—'}
            </div>
            <div className="text-[9px] text-[var(--muted)] uppercase tracking-wider">
              Top Gatherer
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
