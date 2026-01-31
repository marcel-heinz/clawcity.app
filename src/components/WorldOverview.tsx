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
  
  // Forest regions (left and right sides)
  if (x < 150 && y > 50 && y < 450) return 'forest-west';
  if (x > 350 && y > 50 && y < 450) return 'forest-east';
  
  // Plains regions
  if (y > 300) return 'plains';
  
  // Default to plains for remaining areas
  return 'plains';
}

// Zone badge component that floats over terrain
function ZoneBadge({ 
  zone, 
  className = '' 
}: { 
  zone: ZoneData;
  className?: string;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div 
      className={`zone-badge absolute rounded-xl px-3 py-2 cursor-pointer transition-all duration-200 ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        transform: isHovered ? 'scale(1.05)' : 'scale(1)',
      }}
    >
      <div className="text-xs font-bold text-white/90 mb-1">{zone.name}</div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm">👥</span>
        <span className="text-white font-bold text-lg">{zone.agentCount}</span>
      </div>
      
      {/* Expanded details on hover */}
      {isHovered && zone.totalTerritories > 0 && (
        <div className="mt-2 pt-2 border-t border-white/20 animate-fadeIn">
          <div className="text-[10px] text-white/60 mb-1">🏴 {zone.totalTerritories} territories</div>
          {zone.topHolders.length > 0 && (
            <div className="space-y-0.5">
              {zone.topHolders.slice(0, 3).map((holder, i) => (
                <div key={holder.name} className="flex items-center gap-1 text-[10px]">
                  <span className="text-amber-400">{i + 1}.</span>
                  <span className="text-white truncate">{holder.name}</span>
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

// Decorative pixel trees
function PixelTrees({ count, className = '' }: { count: number; className?: string }) {
  return (
    <div className={`flex gap-1 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="pixel-tree" style={{ opacity: 0.7 + Math.random() * 0.3 }} />
      ))}
    </div>
  );
}

// Decorative pixel mountains  
function PixelMountains({ count, className = '' }: { count: number; className?: string }) {
  return (
    <div className={`flex gap-0 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div 
          key={i} 
          className="pixel-mountain" 
          style={{ 
            transform: `scale(${0.8 + Math.random() * 0.4})`,
            opacity: 0.8 + Math.random() * 0.2 
          }} 
        />
      ))}
    </div>
  );
}

export function WorldOverview({ agents }: WorldOverviewProps) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch tiles for territory data
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

  // Calculate zone statistics
  const zoneStats = useMemo(() => {
    const stats = new Map<string, ZoneData>();
    
    // Initialize zones
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

    // Count agents per zone
    agents.forEach(agent => {
      const zoneId = getAgentZone(agent.x, agent.y);
      const zoneStat = stats.get(zoneId);
      if (zoneStat) {
        zoneStat.agentCount++;
      }
    });

    // Count territories per zone
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

    // Calculate top holders
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
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-1.5 bg-[var(--surface)] px-3 py-1.5 rounded-full border border-[var(--border)]">
            <span>👥</span>
            <span className="font-bold text-[var(--accent)]">{totalAgents}</span>
            <span className="text-[var(--muted)] text-xs">online</span>
          </div>
          <div className="flex items-center gap-1.5 bg-[var(--surface)] px-3 py-1.5 rounded-full border border-[var(--border)]">
            <span>🏴</span>
            <span className="font-bold text-amber-400">{totalTerritories}</span>
            <span className="text-[var(--muted)] text-xs">territories</span>
          </div>
        </div>
        <div className="text-[10px] text-[var(--muted)]">Hover zones for details</div>
      </div>

      {/* THE PIXEL ART MAP */}
      <div className="relative rounded-2xl overflow-hidden border-4 border-[#2a2a3a] shadow-2xl" style={{ aspectRatio: '16/10' }}>
        
        {/* ===== ROW 1: Mountains Top ===== */}
        <div className="absolute top-0 left-0 right-0 h-[15%] flex">
          {/* NW Mountains */}
          <div className="w-[20%] h-full terrain-mountain zone-hover-glow relative">
            <ZoneBadge 
              zone={zoneStats.get('mountains-nw')!} 
              className="top-2 left-2"
            />
          </div>
          
          {/* Forest strip top */}
          <div className="w-[25%] h-full terrain-forest" />
          
          {/* Market center top */}
          <div className="w-[30%] h-full terrain-market zone-hover-glow relative">
            <ZoneBadge 
              zone={zoneStats.get('markets')!} 
              className="top-2 left-1/2 -translate-x-1/2"
            />
          </div>
          
          {/* Forest strip top right */}
          <div className="w-[25%] h-full terrain-forest" />
          
          {/* NE Mountains */}
          <div className="w-[20%] h-full terrain-mountain zone-hover-glow relative">
            <ZoneBadge 
              zone={zoneStats.get('mountains-ne')!} 
              className="top-2 right-2"
            />
          </div>
        </div>

        {/* ===== ROW 2: Forest sides + upper content ===== */}
        <div className="absolute top-[15%] left-0 right-0 h-[25%] flex">
          {/* West Forest */}
          <div className="w-[18%] h-full terrain-forest zone-hover-glow relative">
            <ZoneBadge 
              zone={zoneStats.get('forest-west')!} 
              className="top-4 left-2"
            />
          </div>
          
          {/* Grass transition */}
          <div className="w-[12%] h-full terrain-grass" />
          
          {/* Center grass/path area */}
          <div className="w-[40%] h-full terrain-grass relative">
            {/* Path to market */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[30%] h-full terrain-path opacity-70" />
          </div>
          
          {/* Grass transition */}
          <div className="w-[12%] h-full terrain-grass" />
          
          {/* East Forest */}
          <div className="w-[18%] h-full terrain-forest zone-hover-glow relative">
            <ZoneBadge 
              zone={zoneStats.get('forest-east')!} 
              className="top-4 right-2"
            />
          </div>
        </div>

        {/* ===== ROW 3: Lake Center ===== */}
        <div className="absolute top-[40%] left-0 right-0 h-[25%] flex">
          {/* West Forest continues */}
          <div className="w-[18%] h-full terrain-forest" />
          
          {/* Plains west of lake */}
          <div className="w-[15%] h-full terrain-grass" />
          
          {/* THE LAKE */}
          <div className="w-[34%] h-full terrain-water zone-hover-glow relative rounded-full mx-auto">
            <ZoneBadge 
              zone={zoneStats.get('lake')!} 
              className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            />
            {/* Lake shore effect */}
            <div className="absolute inset-2 rounded-full border-4 border-[#3498db]/30" />
          </div>
          
          {/* Plains east of lake */}
          <div className="w-[15%] h-full terrain-grass" />
          
          {/* East Forest continues */}
          <div className="w-[18%] h-full terrain-forest" />
        </div>

        {/* ===== ROW 4: Plains ===== */}
        <div className="absolute top-[65%] left-0 right-0 h-[20%] flex">
          {/* SW transition */}
          <div className="w-[15%] h-full terrain-grass" />
          
          {/* Main Plains */}
          <div className="w-[70%] h-full terrain-grass zone-hover-glow relative">
            <ZoneBadge 
              zone={zoneStats.get('plains')!} 
              className="top-2 left-1/2 -translate-x-1/2"
            />
            {/* Decorative elements */}
            <div className="absolute bottom-2 left-[20%] text-2xl opacity-60">🌾</div>
            <div className="absolute bottom-4 right-[25%] text-xl opacity-50">🌻</div>
            <div className="absolute top-2 left-[40%] text-lg opacity-40">🌿</div>
          </div>
          
          {/* SE transition */}
          <div className="w-[15%] h-full terrain-grass" />
        </div>

        {/* ===== ROW 5: Mountains Bottom ===== */}
        <div className="absolute bottom-0 left-0 right-0 h-[15%] flex">
          {/* SW Mountains */}
          <div className="w-[25%] h-full terrain-mountain zone-hover-glow relative">
            <ZoneBadge 
              zone={zoneStats.get('mountains-sw')!} 
              className="bottom-2 left-2"
            />
          </div>
          
          {/* Plains bottom */}
          <div className="w-[50%] h-full terrain-grass" />
          
          {/* SE Mountains */}
          <div className="w-[25%] h-full terrain-mountain zone-hover-glow relative">
            <ZoneBadge 
              zone={zoneStats.get('mountains-se')!} 
              className="bottom-2 right-2"
            />
          </div>
        </div>

        {/* Decorative overlay grid lines */}
        <div className="absolute inset-0 pointer-events-none opacity-5">
          <div className="w-full h-full" style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '32px 32px'
          }} />
        </div>

        {/* Vignette effect */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)'
        }} />
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap justify-center gap-4 text-[11px] text-[var(--muted)]">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded terrain-grass border border-white/20" /> Plains
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded terrain-forest border border-white/20" /> Forest
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded terrain-mountain border border-white/20" /> Mountain
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded terrain-water border border-white/20" /> Water
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded terrain-market border border-white/20" /> Market
        </span>
      </div>
    </div>
  );
}
