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
  const showConnectingState =
    !isConnected &&
    totalAgents === 0 &&
    activeAgents === 0 &&
    totalTrades === 0 &&
    totalTerritories === 0 &&
    totalResourceValue === 0 &&
    miningActivityLastHour === 0 &&
    !topGatherer;
  const statusText = isConnected ? 'Live' : showConnectingState ? 'Connecting...' : 'Disconnected';
  const statusColorClass = isConnected
    ? 'text-[var(--accent)] font-medium'
    : showConnectingState
      ? 'text-[var(--gold)]'
      : 'text-[var(--red)]';
  const statusDotClass = isConnected
    ? 'bg-[var(--accent)] animate-pulse'
    : showConnectingState
      ? 'bg-[var(--gold)] animate-pulse'
      : 'bg-[var(--red)]';
  const metricValue = (value: number) => (showConnectingState ? '—' : value.toString());
  const compactMetricValue = (value: number) => (showConnectingState ? '—' : formatNumber(value));
  const topGathererLabel = showConnectingState ? 'syncing' : topGatherer || '—';

  return (
    <div className="space-y-3">
      {/* Connection status */}
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`w-2 h-2 rounded-full ${statusDotClass}`}
        />
        <span className={statusColorClass}>
          {statusText}
        </span>
      </div>

      {/* Stats cards - 2x2 grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[var(--surface-alt)] p-3 border-2 border-[var(--border)]">
          <div className="text-2xl font-bold text-[var(--accent)]">
            {metricValue(totalAgents)}
          </div>
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
            Total Agents
          </div>
        </div>

        <div className="bg-[var(--surface-alt)] p-3 border-2 border-[var(--border)]">
          <div className="text-2xl font-bold text-[var(--accent)]">
            {metricValue(activeAgents)}
          </div>
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
            Active Now
          </div>
        </div>

        <div className="bg-[var(--surface-alt)] p-3 border-2 border-[var(--border)]">
          <div className="text-2xl font-bold text-[var(--gold)]">
            {metricValue(totalTrades)}
          </div>
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
            Trades
          </div>
        </div>

        <div className="bg-[var(--surface-alt)] p-3 border-2 border-[var(--border)]">
          <div className="text-2xl font-bold text-purple-600">
            {metricValue(totalTerritories)}
          </div>
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
            Territories
          </div>
        </div>
      </div>

      {/* Resource Economy Section */}
      <div className="border-t-2 border-[var(--border)] pt-3">
        <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider mb-2">
          World Economy
        </div>
        
        {/* Total Resources */}
        <div className="bg-[var(--surface-alt)] p-3 border-2 border-[var(--border)] mb-2">
          <div className="text-lg font-bold text-orange-500">
            {compactMetricValue(totalResourceValue)}
          </div>
          <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
            Total Resources
          </div>
          {totalResources && !showConnectingState && (
            <div className="flex flex-wrap gap-2 mt-2 text-[10px]">
              <span className="text-yellow-600" title="Gold">🪙 {formatNumber(totalResources.gold)}</span>
              <span className="text-amber-700" title="Wood">🪵 {formatNumber(totalResources.wood)}</span>
              <span className="text-gray-500" title="Stone">🪨 {formatNumber(totalResources.stone)}</span>
              <span className="text-red-500" title="Food">🍎 {formatNumber(totalResources.food)}</span>
            </div>
          )}
        </div>

        {/* Mining Activity */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-[var(--surface-alt)] p-2 border-2 border-[var(--border)]">
            <div className="text-lg font-bold text-cyan-600">
              {metricValue(miningActivityLastHour)}
            </div>
            <div className="text-[9px] text-[var(--muted)] uppercase tracking-wider">
              Gathers (1h)
            </div>
          </div>

          <div className="bg-[var(--surface-alt)] p-2 border-2 border-[var(--border)]">
            <div className="text-sm font-bold text-pink-600 truncate" title={topGathererLabel}>
              {topGathererLabel}
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
