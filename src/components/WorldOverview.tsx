'use client';

import { useEffect, useState, useMemo } from 'react';
import { AgentPublic, Tile } from '@/lib/types';

interface WorldOverviewProps {
  agents: AgentPublic[];
}

interface ZoneData {
  id: string;
  name: string;
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

// Compact zone badge
function ZoneBadge({ 
  zone, 
  compact = false,
  className = '' 
}: { 
  zone: ZoneData;
  compact?: boolean;
  className?: string;
}) {
  const [isHovered, setIsHovered] = useState(false);

  if (compact) {
    return (
      <div 
        className={`zone-badge rounded-lg px-2 py-1 cursor-pointer transition-all duration-200 ${className}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{ transform: isHovered ? 'scale(1.1)' : 'scale(1)' }}
      >
        <div className="text-[10px] font-bold text-white/80 whitespace-nowrap">{zone.name}</div>
        <div className="flex items-center gap-1">
          <span className="text-xs">👥</span>
          <span className="text-white font-bold">{zone.agentCount}</span>
        </div>
        {isHovered && zone.totalTerritories > 0 && (
          <div className="mt-1 pt-1 border-t border-white/20 text-[9px] text-white/60">
            🏴 {zone.totalTerritories} claimed
          </div>
        )}
      </div>
    );
  }

  return (
    <div 
      className={`zone-badge rounded-xl px-3 py-2 cursor-pointer transition-all duration-200 ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ transform: isHovered ? 'scale(1.05)' : 'scale(1)' }}
    >
      <div className="text-xs font-bold text-white/90 mb-1">{zone.name}</div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm">👥</span>
        <span className="text-white font-bold text-lg">{zone.agentCount}</span>
      </div>
      
      {isHovered && zone.totalTerritories > 0 && (
        <div className="mt-2 pt-2 border-t border-white/20">
          <div className="text-[10px] text-white/60 mb-1">🏴 {zone.totalTerritories} territories</div>
          {zone.topHolders.length > 0 && (
            <div className="space-y-0.5">
              {zone.topHolders.slice(0, 3).map((holder, i) => (
                <div key={holder.name} className="flex items-center gap-1 text-[10px]">
                  <span className="text-amber-400">{i + 1}.</span>
                  <span className="text-white truncate max-w-[80px]">{holder.name}</span>
                  <span className="text-white/50">({holder.count})</span>
                </div>
              ))}
            </div>
          )}
        </div>
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
      { id: 'mountains-nw', name: 'Northern Peaks' },
      { id: 'mountains-ne', name: 'Eastern Cliffs' },
      { id: 'mountains-sw', name: 'Southern Range' },
      { id: 'mountains-se', name: 'Dragon Peaks' },
      { id: 'forest-west', name: 'Western Woods' },
      { id: 'forest-east', name: 'Eastern Grove' },
      { id: 'lake', name: 'Crystal Lake' },
      { id: 'markets', name: 'Trade District' },
      { id: 'plains', name: 'Golden Plains' },
    ];
    
    zones.forEach(z => {
      stats.set(z.id, {
        id: z.id,
        name: z.name,
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
      <div className="flex items-center justify-center h-[400px] text-[var(--muted)]">
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
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-1.5 bg-black/30 px-3 py-1.5 rounded-full border border-white/10">
            <span>👥</span>
            <span className="font-bold text-[var(--accent)]">{totalAgents}</span>
            <span className="text-[var(--muted)] text-xs">online</span>
          </div>
          <div className="flex items-center gap-1.5 bg-black/30 px-3 py-1.5 rounded-full border border-white/10">
            <span>🏴</span>
            <span className="font-bold text-amber-400">{totalTerritories}</span>
            <span className="text-[var(--muted)] text-xs">territories</span>
          </div>
        </div>
        <div className="text-[10px] text-[var(--muted)]">Hover for details</div>
      </div>

      {/* THE MAP - Using CSS Grid for precise layout */}
      <div className="relative rounded-2xl overflow-hidden border-4 border-[#1a1a2e] shadow-2xl bg-[#1a1a2e]">
        <div className="grid grid-cols-12 grid-rows-6" style={{ aspectRatio: '2/1' }}>
          
          {/* Row 1: Top mountains and market */}
          <div className="col-span-2 row-span-1 terrain-mountain relative flex items-start justify-start p-1">
            <ZoneBadge zone={zoneStats.get('mountains-nw')!} compact className="scale-90 origin-top-left" />
          </div>
          <div className="col-span-2 row-span-1 terrain-forest" />
          <div className="col-span-4 row-span-1 terrain-market relative flex items-start justify-center pt-1">
            <ZoneBadge zone={zoneStats.get('markets')!} compact />
          </div>
          <div className="col-span-2 row-span-1 terrain-forest" />
          <div className="col-span-2 row-span-1 terrain-mountain relative flex items-start justify-end p-1">
            <ZoneBadge zone={zoneStats.get('mountains-ne')!} compact className="scale-90 origin-top-right" />
          </div>

          {/* Row 2: Forest sides, grass middle */}
          <div className="col-span-2 row-span-2 terrain-forest relative flex items-center justify-start pl-1">
            <ZoneBadge zone={zoneStats.get('forest-west')!} compact />
          </div>
          <div className="col-span-1 row-span-2 terrain-grass" />
          <div className="col-span-6 row-span-2 terrain-grass relative">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1/4 h-full terrain-path opacity-50" />
            </div>
          </div>
          <div className="col-span-1 row-span-2 terrain-grass" />
          <div className="col-span-2 row-span-2 terrain-forest relative flex items-center justify-end pr-1">
            <ZoneBadge zone={zoneStats.get('forest-east')!} compact />
          </div>

          {/* Row 3-4: Lake in center, plains around */}
          <div className="col-span-2 row-span-2 terrain-grass" />
          <div className="col-span-8 row-span-2 relative flex items-center justify-center">
            {/* Lake */}
            <div className="absolute inset-4 terrain-water rounded-[40%] flex items-center justify-center shadow-lg shadow-blue-500/30">
              <ZoneBadge zone={zoneStats.get('lake')!} />
            </div>
            {/* Grass around lake */}
            <div className="absolute inset-0 terrain-grass -z-10" />
          </div>
          <div className="col-span-2 row-span-2 terrain-grass" />

          {/* Row 5: Plains */}
          <div className="col-span-12 row-span-1 terrain-grass relative flex items-center justify-center">
            <ZoneBadge zone={zoneStats.get('plains')!} />
            <span className="absolute left-[15%] text-xl opacity-40">🌾</span>
            <span className="absolute right-[20%] text-lg opacity-30">🌻</span>
          </div>

          {/* Row 6: Bottom mountains */}
          <div className="col-span-3 row-span-1 terrain-mountain relative flex items-end justify-start p-1">
            <ZoneBadge zone={zoneStats.get('mountains-sw')!} compact className="scale-90 origin-bottom-left" />
          </div>
          <div className="col-span-6 row-span-1 terrain-grass" />
          <div className="col-span-3 row-span-1 terrain-mountain relative flex items-end justify-end p-1">
            <ZoneBadge zone={zoneStats.get('mountains-se')!} compact className="scale-90 origin-bottom-right" />
          </div>
        </div>

        {/* Subtle grid overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }} />

        {/* Vignette */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%)'
        }} />
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap justify-center gap-4 text-[11px] text-[var(--muted)]">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded terrain-grass border border-white/10" /> Plains
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded terrain-forest border border-white/10" /> Forest
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded terrain-mountain border border-white/10" /> Mountain
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded terrain-water border border-white/10" /> Water
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded terrain-market border border-white/10" /> Market
        </span>
      </div>
    </div>
  );
}
