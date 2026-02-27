'use client';

import { type HomeLiveState, getHomeLiveStatusPresentation } from '@/lib/home-live-state';

interface StatsProps {
  totalResources?: {
    gold: number;
    wood: number;
    food: number;
    stone: number;
  };
  miningActivityLastHour?: number;
  topGatherer?: string | null;
  liveState: HomeLiveState;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

export function Stats({ 
  totalResources,
  miningActivityLastHour = 0,
  topGatherer,
  liveState,
}: StatsProps) {
  const lifecycle = getHomeLiveStatusPresentation(liveState);
  const totalResourceValue = totalResources 
    ? totalResources.gold + totalResources.wood + totalResources.food + totalResources.stone
    : 0;
  const hideLiveMetrics = liveState.phase !== 'live' && !liveState.isStaleSnapshot;
  const metricValue = (value: number) => (hideLiveMetrics ? '—' : value.toString());
  const compactMetricValue = (value: number) => (hideLiveMetrics ? '—' : formatNumber(value));
  const topGathererLabel = hideLiveMetrics ? '—' : topGatherer || '—';
  const resourceBreakdown = totalResources
    ? [
      { icon: '🪙', value: totalResources.gold, className: 'text-yellow-600' },
      { icon: '🪵', value: totalResources.wood, className: 'text-amber-700' },
      { icon: '🪨', value: totalResources.stone, className: 'text-gray-500' },
      { icon: '🍎', value: totalResources.food, className: 'text-red-500' },
    ]
    : [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px]" role="status" aria-live="polite">
        <span
          className={`h-2 w-2 rounded-full ${lifecycle.dotClassName}`}
        />
        <span className={lifecycle.textClassName}>
          {lifecycle.label}
        </span>
      </div>
      {liveState.isStaleSnapshot && (
        <div className="text-[10px] text-[var(--gold)]">{lifecycle.detail}</div>
      )}

      <div className="bg-[var(--surface-alt)] border-2 border-[var(--border)] p-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-xl font-bold text-orange-500 leading-none">
              {compactMetricValue(totalResourceValue)}
            </div>
            <div className="mt-1 text-[10px] text-[var(--muted)] uppercase tracking-wider">
              Total Resources
            </div>
          </div>
          {totalResources && !hideLiveMetrics && (
            <div className="flex flex-wrap items-center justify-end gap-1 text-[10px]">
              {resourceBreakdown.map((resource) => (
                <span key={resource.icon} className={resource.className}>
                  {resource.icon} {formatNumber(resource.value)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[var(--surface-alt)] border-2 border-[var(--border)] p-2">
          <div className="text-lg font-bold text-cyan-600 leading-none">
            {metricValue(miningActivityLastHour)}
          </div>
          <div className="mt-1 text-[9px] text-[var(--muted)] uppercase tracking-wider">
            Gathers (1h)
          </div>
        </div>

        <div className="bg-[var(--surface-alt)] border-2 border-[var(--border)] p-2">
          <div className="text-sm font-bold text-pink-600 truncate leading-none" title={topGathererLabel}>
            {topGathererLabel}
          </div>
          <div className="mt-1 text-[9px] text-[var(--muted)] uppercase tracking-wider">
            Top Gatherer
          </div>
        </div>
      </div>
    </div>
  );
}
