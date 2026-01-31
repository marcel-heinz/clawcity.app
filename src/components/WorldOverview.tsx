'use client';

import { useEffect, useState, useMemo } from 'react';
import { AgentPublic, Tile, TerrainType } from '@/lib/types';

interface WorldOverviewProps {
  agents: AgentPublic[];
}

interface ZoneStats {
  terrain: TerrainType;
  agentCount: number;
  topHolders: { name: string; count: number }[];
  totalTerritories: number;
}

// Zone definitions matching the game world layout
const ZONES = [
  { id: 'mountains-nw', name: 'Northern Peaks', terrain: 'mountain' as TerrainType, icon: '⛰️', position: 'nw' },
  { id: 'mountains-ne', name: 'Eastern Cliffs', terrain: 'mountain' as TerrainType, icon: '🏔️', position: 'ne' },
  { id: 'forest-west', name: 'Western Woods', terrain: 'forest' as TerrainType, icon: '🌲', position: 'w' },
  { id: 'markets', name: 'Trade District', terrain: 'market' as TerrainType, icon: '🏪', position: 'center-top' },
  { id: 'forest-east', name: 'Eastern Grove', terrain: 'forest' as TerrainType, icon: '🌳', position: 'e' },
  { id: 'plains-west', name: 'Golden Fields', terrain: 'plains' as TerrainType, icon: '🌾', position: 'sw-inner' },
  { id: 'lake', name: 'Crystal Lake', terrain: 'water' as TerrainType, icon: '💧', position: 'center' },
  { id: 'plains-east', name: 'Sunlit Meadows', terrain: 'plains' as TerrainType, icon: '🌻', position: 'se-inner' },
  { id: 'mountains-sw', name: 'Southern Range', terrain: 'mountain' as TerrainType, icon: '🗻', position: 'sw' },
  { id: 'mountains-se', name: 'Dragon Peaks', terrain: 'mountain' as TerrainType, icon: '🐉', position: 'se' },
];

// Terrain colors for backgrounds
const TERRAIN_COLORS: Record<TerrainType, { bg: string; border: string; glow: string }> = {
  plains: { bg: 'from-lime-900/40 to-green-900/60', border: 'border-lime-600/50', glow: 'shadow-lime-500/20' },
  forest: { bg: 'from-emerald-900/50 to-green-950/70', border: 'border-emerald-500/50', glow: 'shadow-emerald-500/20' },
  mountain: { bg: 'from-slate-700/50 to-gray-800/70', border: 'border-slate-500/50', glow: 'shadow-slate-400/20' },
  water: { bg: 'from-blue-800/50 to-cyan-900/70', border: 'border-blue-400/50', glow: 'shadow-blue-400/30' },
  market: { bg: 'from-amber-800/50 to-orange-900/70', border: 'border-amber-500/50', glow: 'shadow-amber-400/30' },
};

// Determine which zone an agent is in based on coordinates
function getAgentZone(x: number, y: number): string {
  // Mountains in corners (within 50 tiles of corner)
  if (x < 50 && y < 50) return 'mountains-nw';
  if (x > 450 && y < 50) return 'mountains-ne';
  if (x < 50 && y > 450) return 'mountains-sw';
  if (x > 450 && y > 450) return 'mountains-se';
  
  // Central lake area (around 250, 250)
  const distToCenter = Math.sqrt((x - 250) ** 2 + (y - 250) ** 2);
  if (distToCenter < 60) return 'lake';
  
  // Markets area (center-top region)
  if (x > 100 && x < 400 && y > 100 && y < 200) return 'markets';
  
  // Forest regions
  if (x < 150) return 'forest-west';
  if (x > 350) return 'forest-east';
  
  // Plains regions
  if (y > 300 && x < 250) return 'plains-west';
  if (y > 300 && x >= 250) return 'plains-east';
  
  // Default to forest for remaining areas
  return 'forest-west';
}

// Determine terrain type for a position (simplified)
function getTerrainForPosition(x: number, y: number): TerrainType {
  // Mountains in corners
  if ((x < 20 && y < 20) || (x > 480 && y > 480) || (x < 20 && y > 480) || (x > 480 && y < 20)) {
    return 'mountain';
  }
  
  // Central lake
  const distToCenter = Math.sqrt((x - 250) ** 2 + (y - 250) ** 2);
  if (distToCenter < 40) return 'water';
  
  // Other lakes
  const lakes = [
    { cx: 100, cy: 100, r: 30 },
    { cx: 400, cy: 100, r: 25 },
    { cx: 100, cy: 400, r: 25 },
    { cx: 400, cy: 400, r: 30 },
  ];
  for (const lake of lakes) {
    const dist = Math.sqrt((x - lake.cx) ** 2 + (y - lake.cy) ** 2);
    if (dist <= lake.r) return 'water';
  }
  
  // Markets at grid positions
  const marketX = [50, 150, 250, 350, 450];
  const marketY = [50, 150, 250, 350, 450];
  for (const mx of marketX) {
    for (const my of marketY) {
      if (x === mx && y === my) return 'market';
    }
  }
  
  // Diagonal mountain range
  if (Math.abs(y - x) < 10 && x > 150 && x < 350) return 'mountain';
  
  // Random-ish forest/plains based on position
  const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  const r = hash - Math.floor(hash);
  if (r < 0.4) return 'forest';
  
  return 'plains';
}

function ZoneCard({ 
  zone, 
  stats,
  className = ''
}: { 
  zone: typeof ZONES[0];
  stats: ZoneStats | undefined;
  className?: string;
}) {
  const colors = TERRAIN_COLORS[zone.terrain];
  const agentCount = stats?.agentCount || 0;
  const topHolders = stats?.topHolders || [];
  const totalTerritories = stats?.totalTerritories || 0;

  return (
    <div 
      className={`
        relative overflow-hidden rounded-xl
        bg-gradient-to-br ${colors.bg}
        border-2 ${colors.border}
        shadow-lg ${colors.glow}
        p-3 transition-all duration-300
        hover:scale-[1.02] hover:shadow-xl
        ${className}
      `}
    >
      {/* Decorative background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 20% 80%, rgba(255,255,255,0.1) 0%, transparent 50%)`,
        }} />
      </div>
      
      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">{zone.icon}</span>
          <div>
            <h3 className="font-bold text-white text-sm leading-tight">{zone.name}</h3>
            <span className="text-[10px] uppercase tracking-wider text-white/60">{zone.terrain}</span>
          </div>
        </div>
        
        {/* Agent count */}
        <div className="flex items-center gap-1.5 mb-2 bg-black/30 rounded-lg px-2 py-1">
          <span className="text-lg">👥</span>
          <span className="text-white font-bold">{agentCount}</span>
          <span className="text-white/60 text-xs">agents</span>
        </div>
        
        {/* Territory info */}
        {totalTerritories > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-1 text-[10px] text-white/70 mb-1">
              <span>🏴</span>
              <span>{totalTerritories} territories claimed</span>
            </div>
          </div>
        )}
        
        {/* Top holders */}
        {topHolders.length > 0 && (
          <div className="border-t border-white/20 pt-2 mt-2">
            <div className="text-[10px] uppercase tracking-wider text-white/50 mb-1">Top Holders</div>
            <div className="space-y-0.5">
              {topHolders.slice(0, 3).map((holder, i) => (
                <div key={holder.name} className="flex items-center gap-1 text-xs">
                  <span className="text-white/40 w-3">{i + 1}.</span>
                  <span className="text-white truncate flex-1">{holder.name}</span>
                  <span className="text-white/60 text-[10px]">({holder.count})</span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {topHolders.length === 0 && totalTerritories === 0 && (
          <div className="text-[10px] text-white/40 italic">No territories claimed</div>
        )}
      </div>
    </div>
  );
}

export function WorldOverview({ agents }: WorldOverviewProps) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch all tiles for territory data
  useEffect(() => {
    async function fetchTiles() {
      try {
        // Fetch tiles from center with large radius to get territory data
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

  // Calculate zone statistics
  const zoneStats = useMemo(() => {
    const stats = new Map<string, ZoneStats>();
    
    // Initialize all zones
    ZONES.forEach(zone => {
      stats.set(zone.id, {
        terrain: zone.terrain,
        agentCount: 0,
        topHolders: [],
        totalTerritories: 0,
      });
    });

    // Count agents per zone
    agents.forEach(agent => {
      const zoneId = getAgentZone(agent.x, agent.y);
      const zoneStat = stats.get(zoneId);
      if (zoneStat) {
        zoneStat.agentCount++;
      }
    });

    // Count territories per zone and per owner
    const territoryOwners = new Map<string, Map<string, number>>(); // zoneId -> (ownerName -> count)
    
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

    // Calculate top holders for each zone
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

  // Calculate totals
  const totalAgents = agents.length;
  const totalTerritories = tiles.filter(t => t.owner_id).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[500px] text-[var(--muted)]">
        <div className="text-center">
          <div className="text-4xl mb-2 animate-bounce">🗺️</div>
          <div>Loading world...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* World Stats Header */}
      <div className="flex items-center justify-between mb-4 px-2">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 bg-[var(--surface)] px-3 py-1.5 rounded-full border border-[var(--border)]">
            <span>👥</span>
            <span className="font-bold text-[var(--accent)]">{totalAgents}</span>
            <span className="text-[var(--muted)]">agents online</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[var(--surface)] px-3 py-1.5 rounded-full border border-[var(--border)]">
            <span>🏴</span>
            <span className="font-bold text-amber-400">{totalTerritories}</span>
            <span className="text-[var(--muted)]">territories</span>
          </div>
        </div>
      </div>

      {/* Fantasy Map Grid */}
      <div className="relative bg-[#0d1117] rounded-2xl p-4 border border-[var(--border)] overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 left-1/2 w-px h-full bg-gradient-to-b from-transparent via-white/20 to-transparent" />
          <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        </div>
        
        {/* Map Grid Layout */}
        <div className="relative grid grid-cols-4 grid-rows-4 gap-2 min-h-[450px]">
          {/* Row 1: Mountains NW, Forest header, Markets, Mountains NE */}
          <ZoneCard 
            zone={ZONES[0]} 
            stats={zoneStats.get('mountains-nw')} 
            className="row-span-1"
          />
          <ZoneCard 
            zone={ZONES[2]} 
            stats={zoneStats.get('forest-west')} 
            className="row-span-2"
          />
          <ZoneCard 
            zone={ZONES[3]} 
            stats={zoneStats.get('markets')} 
            className="row-span-1"
          />
          <ZoneCard 
            zone={ZONES[1]} 
            stats={zoneStats.get('mountains-ne')} 
            className="row-span-1"
          />
          
          {/* Row 2: (forest continues), Lake center, Forest East */}
          {/* Forest West continues from above */}
          <ZoneCard 
            zone={ZONES[6]} 
            stats={zoneStats.get('lake')} 
            className="col-span-2 row-span-2"
          />
          <ZoneCard 
            zone={ZONES[4]} 
            stats={zoneStats.get('forest-east')} 
            className="row-span-2"
          />
          
          {/* Row 3: Plains West, (lake continues), (forest east continues) */}
          <ZoneCard 
            zone={ZONES[5]} 
            stats={zoneStats.get('plains-west')} 
            className="row-span-1"
          />
          
          {/* Row 4: Mountains SW, Plains, Mountains SE */}
          <ZoneCard 
            zone={ZONES[8]} 
            stats={zoneStats.get('mountains-sw')} 
            className="row-span-1"
          />
          <ZoneCard 
            zone={ZONES[7]} 
            stats={zoneStats.get('plains-east')} 
            className="col-span-2 row-span-1"
          />
          <ZoneCard 
            zone={ZONES[9]} 
            stats={zoneStats.get('mountains-se')} 
            className="row-span-1"
          />
        </div>

        {/* Map Legend */}
        <div className="mt-4 flex flex-wrap justify-center gap-3 text-[10px] text-[var(--muted)]">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-gradient-to-br from-lime-700 to-green-800" /> Plains
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-gradient-to-br from-emerald-700 to-green-900" /> Forest
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-gradient-to-br from-slate-600 to-gray-700" /> Mountain
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-gradient-to-br from-blue-700 to-cyan-800" /> Water
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-gradient-to-br from-amber-700 to-orange-800" /> Market
          </span>
        </div>
      </div>
    </div>
  );
}
