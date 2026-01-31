'use client';

import { useEffect, useState, useMemo } from 'react';
import { AgentPublic, Tile } from '@/lib/types';

interface WorldOverviewProps {
  agents: AgentPublic[];
}

interface ZoneData {
  id: string;
  name: string;
  shortName: string;
  agentCount: number;
  topHolders: { name: string; count: number }[];
  totalTerritories: number;
}

// Determine which zone an agent is in based on coordinates
function getAgentZone(x: number, y: number): string {
  if (x < 50 && y < 50) return 'mountains-nw';
  if (x > 450 && y < 50) return 'mountains-ne';
  if (x < 50 && y > 450) return 'mountains-sw';
  if (x > 450 && y > 450) return 'mountains-se';
  
  const distToCenter = Math.sqrt((x - 250) ** 2 + (y - 250) ** 2);
  if (distToCenter < 60) return 'lake';
  
  if (x > 100 && x < 400 && y > 100 && y < 200) return 'markets';
  
  if (x < 150 && y > 50 && y < 450) return 'forest-west';
  if (x > 350 && y > 50 && y < 450) return 'forest-east';
  
  return 'plains';
}

// Mobile-friendly zone badge - light mode
function MobileBadge({ zone, className = '' }: { zone: ZoneData; className?: string }) {
  return (
    <div className={`zone-badge rounded-md px-1.5 py-0.5 ${className}`}>
      <div className="text-[8px] font-medium text-[var(--muted)] leading-tight">{zone.shortName}</div>
      <div className="flex items-center gap-0.5">
        <span className="text-[10px]">👥</span>
        <span className="text-[var(--foreground)] font-bold text-sm">{zone.agentCount}</span>
      </div>
    </div>
  );
}

// Desktop zone badge - light mode
function DesktopBadge({ zone, className = '' }: { zone: ZoneData; className?: string }) {
  return (
    <div className={`zone-badge rounded-lg px-2 py-1.5 ${className}`}>
      <div className="text-[10px] font-bold text-[var(--foreground)] whitespace-nowrap">{zone.name}</div>
      <div className="flex items-center gap-1">
        <span className="text-xs">👥</span>
        <span className="text-[var(--foreground)] font-bold">{zone.agentCount}</span>
      </div>
      {zone.totalTerritories > 0 && (
        <div className="text-[8px] text-[var(--muted)] mt-0.5">🏴 {zone.totalTerritories}</div>
      )}
    </div>
  );
}

export function WorldOverview({ agents }: WorldOverviewProps) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTiles() {
      try {
        const response = await fetch('/api/world/tiles?x=250&y=250&radius=300');
        const data = await response.json();
        if (data.success) {
          setTiles(data.data.tiles);
        }
      } catch (error) {
        console.error('Error fetching tiles:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchTiles();
  }, []);

  const zoneStats = useMemo(() => {
    const stats = new Map<string, ZoneData>();
    
    const zones = [
      { id: 'mountains-nw', name: 'Northern Peaks', shortName: 'N. Peaks' },
      { id: 'mountains-ne', name: 'Eastern Cliffs', shortName: 'E. Cliffs' },
      { id: 'mountains-sw', name: 'Southern Range', shortName: 'S. Range' },
      { id: 'mountains-se', name: 'Dragon Peaks', shortName: 'Dragon' },
      { id: 'forest-west', name: 'Western Woods', shortName: 'W. Woods' },
      { id: 'forest-east', name: 'Eastern Grove', shortName: 'E. Grove' },
      { id: 'lake', name: 'Crystal Lake', shortName: 'Lake' },
      { id: 'markets', name: 'Trade District', shortName: 'Market' },
      { id: 'plains', name: 'Golden Plains', shortName: 'Plains' },
    ];
    
    zones.forEach(z => {
      stats.set(z.id, {
        ...z,
        agentCount: 0,
        topHolders: [],
        totalTerritories: 0,
      });
    });

    agents.forEach(agent => {
      const zoneId = getAgentZone(agent.x, agent.y);
      const zoneStat = stats.get(zoneId);
      if (zoneStat) zoneStat.agentCount++;
    });

    const territoryOwners = new Map<string, Map<string, number>>();
    tiles.forEach(tile => {
      if (tile.owner_id && tile.owner_name) {
        const zoneId = getAgentZone(tile.x, tile.y);
        const zoneStat = stats.get(zoneId);
        if (zoneStat) {
          zoneStat.totalTerritories++;
          if (!territoryOwners.has(zoneId)) {
            territoryOwners.set(zoneId, new Map());
          }
          const owners = territoryOwners.get(zoneId)!;
          owners.set(tile.owner_name, (owners.get(tile.owner_name) || 0) + 1);
        }
      }
    });

    territoryOwners.forEach((owners, zoneId) => {
      const zoneStat = stats.get(zoneId);
      if (zoneStat) {
        zoneStat.topHolders = Array.from(owners.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
      }
    });

    return stats;
  }, [agents, tiles]);

  const totalAgents = agents.length;
  const totalTerritories = tiles.filter(t => t.owner_id).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[300px] md:h-[400px] text-[var(--muted)]">
        <div className="text-center">
          <div className="text-4xl mb-2 animate-bounce">🗺️</div>
          <div>Loading world...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Stats Header */}
      <div className="flex items-center gap-2 md:gap-3 text-sm mb-3">
        <div className="flex items-center gap-1 md:gap-1.5 bg-[var(--surface-alt)] px-2 md:px-3 py-1 md:py-1.5 border-2 border-[var(--border)]">
          <span>👥</span>
          <span className="font-bold text-[var(--accent)]">{totalAgents}</span>
          <span className="text-[var(--muted)] text-[10px] md:text-xs hidden sm:inline">online</span>
        </div>
        <div className="flex items-center gap-1 md:gap-1.5 bg-[var(--surface-alt)] px-2 md:px-3 py-1 md:py-1.5 border-2 border-[var(--border)]">
          <span>🏴</span>
          <span className="font-bold text-[var(--gold)]">{totalTerritories}</span>
          <span className="text-[var(--muted)] text-[10px] md:text-xs hidden sm:inline">territories</span>
        </div>
      </div>

      {/* THE MAP */}
      <div className="relative rounded-xl md:rounded-2xl overflow-hidden border-4 border-[var(--foreground)] shadow-[8px_8px_0_rgba(45,42,38,0.2)] bg-[var(--surface-alt)]">
        
        {/* Mobile Layout (< md) - Simpler 3x3 grid */}
        <div className="grid grid-cols-3 grid-rows-3 md:hidden" style={{ aspectRatio: '4/3' }}>
          {/* Row 1 */}
          <div className="terrain-mountain-map relative flex items-start justify-start p-1">
            <MobileBadge zone={zoneStats.get('mountains-nw')!} />
          </div>
          <div className="terrain-market-map relative flex items-start justify-center p-1">
            <MobileBadge zone={zoneStats.get('markets')!} />
          </div>
          <div className="terrain-mountain-map relative flex items-start justify-end p-1">
            <MobileBadge zone={zoneStats.get('mountains-ne')!} />
          </div>
          
          {/* Row 2 */}
          <div className="terrain-forest-map relative flex items-center justify-start p-1">
            <MobileBadge zone={zoneStats.get('forest-west')!} />
          </div>
          <div className="terrain-water-map relative flex items-center justify-center">
            <MobileBadge zone={zoneStats.get('lake')!} />
          </div>
          <div className="terrain-forest-map relative flex items-center justify-end p-1">
            <MobileBadge zone={zoneStats.get('forest-east')!} />
          </div>
          
          {/* Row 3 */}
          <div className="terrain-mountain-map relative flex items-end justify-start p-1">
            <MobileBadge zone={zoneStats.get('mountains-sw')!} />
          </div>
          <div className="terrain-grass relative flex items-end justify-center p-1">
            <MobileBadge zone={zoneStats.get('plains')!} />
          </div>
          <div className="terrain-mountain-map relative flex items-end justify-end p-1">
            <MobileBadge zone={zoneStats.get('mountains-se')!} />
          </div>
        </div>

        {/* Desktop Layout (>= md) - Full detailed grid */}
        <div className="hidden md:grid grid-cols-12 grid-rows-5" style={{ aspectRatio: '5/2' }}>
          {/* Row 1: Top mountains and market */}
          <div className="col-span-2 row-span-1 terrain-mountain-map relative flex items-start justify-start p-1">
            <DesktopBadge zone={zoneStats.get('mountains-nw')!} className="scale-90 origin-top-left" />
          </div>
          <div className="col-span-2 row-span-1 terrain-forest-map" />
          <div className="col-span-4 row-span-1 terrain-market-map relative flex items-start justify-center pt-1">
            <DesktopBadge zone={zoneStats.get('markets')!} />
          </div>
          <div className="col-span-2 row-span-1 terrain-forest-map" />
          <div className="col-span-2 row-span-1 terrain-mountain-map relative flex items-start justify-end p-1">
            <DesktopBadge zone={zoneStats.get('mountains-ne')!} className="scale-90 origin-top-right" />
          </div>

          {/* Row 2: Forest sides, grass middle */}
          <div className="col-span-2 row-span-1 terrain-forest-map relative flex items-center justify-start pl-1">
            <DesktopBadge zone={zoneStats.get('forest-west')!} />
          </div>
          <div className="col-span-8 row-span-1 terrain-grass" />
          <div className="col-span-2 row-span-1 terrain-forest-map relative flex items-center justify-end pr-1">
            <DesktopBadge zone={zoneStats.get('forest-east')!} />
          </div>

          {/* Row 3: Lake in center */}
          <div className="col-span-2 row-span-1 terrain-grass" />
          <div className="col-span-8 row-span-1 terrain-water-map relative flex items-center justify-center rounded-full mx-4 shadow-lg shadow-blue-400/30 border-2 border-blue-300/50">
            <DesktopBadge zone={zoneStats.get('lake')!} />
          </div>
          <div className="col-span-2 row-span-1 terrain-grass" />

          {/* Row 4: Plains */}
          <div className="col-span-12 row-span-1 terrain-grass relative flex items-center justify-center">
            <DesktopBadge zone={zoneStats.get('plains')!} />
            <span className="absolute left-[15%] text-xl opacity-60">🌾</span>
            <span className="absolute right-[20%] text-lg opacity-50">🌻</span>
          </div>

          {/* Row 5: Bottom mountains */}
          <div className="col-span-3 row-span-1 terrain-mountain-map relative flex items-end justify-start p-1">
            <DesktopBadge zone={zoneStats.get('mountains-sw')!} className="scale-90 origin-bottom-left" />
          </div>
          <div className="col-span-6 row-span-1 terrain-grass" />
          <div className="col-span-3 row-span-1 terrain-mountain-map relative flex items-end justify-end p-1">
            <DesktopBadge zone={zoneStats.get('mountains-se')!} className="scale-90 origin-bottom-right" />
          </div>
        </div>

        {/* Vignette - lighter for light mode */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.1) 100%)'
        }} />
      </div>

      {/* Legend - smaller on mobile */}
      <div className="mt-2 md:mt-3 flex flex-wrap justify-center gap-2 md:gap-4 text-[9px] md:text-[11px] text-[var(--muted)]">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded terrain-grass border-2 border-[var(--border)]" /> Plains
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded terrain-forest-map border-2 border-[var(--border)]" /> Forest
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded terrain-mountain-map border-2 border-[var(--border)]" /> Mountain
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded terrain-water-map border-2 border-[var(--border)]" /> Water
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded terrain-market-map border-2 border-[var(--border)]" /> Market
        </span>
      </div>
    </div>
  );
}
