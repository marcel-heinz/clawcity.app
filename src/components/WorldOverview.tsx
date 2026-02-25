'use client';

import { useEffect, useState, useMemo } from 'react';
import { AgentPublic, Tile } from '@/lib/types';
import { AgentCrab } from './CrabSprite';
import { isAgentOnline } from '@/lib/presence';

// Shared presence signal from world/status (with local fallback).
function isActiveAgent(agent: AgentPublic): boolean {
  return isAgentOnline(agent);
}

interface WorldOverviewProps {
  agents: AgentPublic[];
  onAgentClick?: (agentId: string, x: number, y: number) => void;
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
    </div>
  );
}

// Crabs container for a zone
interface ZoneCrabsProps {
  crabs: { agent: AgentPublic; x: number; y: number; floatDelay: number }[];
  scale?: number;
  onAgentClick?: (agentId: string, x: number, y: number) => void;
}

function ZoneCrabs({ crabs, scale = 1.2, onAgentClick }: ZoneCrabsProps) {
  return (
    <>
      {crabs.map(({ agent, x, y }) => (
        <AgentCrab
          key={agent.id}
          agentName={agent.name}
          agentId={agent.id}
          agentX={agent.x}
          agentY={agent.y}
          initialX={x}
          initialY={y}
          scale={scale}
          wanderRadius={12}
          onClick={onAgentClick}
        />
      ))}
    </>
  );
}

export function WorldOverview({ agents, onAgentClick }: WorldOverviewProps) {
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

    // Only count online agents using shared presence logic.
    agents.forEach(agent => {
      if (!isActiveAgent(agent)) return;
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

  // Filter to only online agents using shared presence logic.
  const activeAgents = useMemo(() => {
    return agents.filter(agent => isActiveAgent(agent));
  }, [agents]);

  const activeAgentCount = activeAgents.length;
  const totalAgents = agents.length;

  // Group active agents by zone for crab rendering
  const agentsByZone = useMemo(() => {
    const grouped = new Map<string, AgentPublic[]>();
    activeAgents.forEach(agent => {
      const zoneId = getAgentZone(agent.x, agent.y);
      const existing = grouped.get(zoneId) || [];
      grouped.set(zoneId, [...existing, agent]);
    });
    return grouped;
  }, [activeAgents]);

  // Pre-calculate crab positions for all zones (memoized to avoid duplicates)
  const zoneCrabs = useMemo(() => {
    const result = new Map<string, { agent: AgentPublic; x: number; y: number; floatDelay: number }[]>();
    
    agentsByZone.forEach((zoneAgents, zoneId) => {
      const crabs = zoneAgents.map((agent, index) => {
        // Spread crabs across the zone with some randomization based on agent id
        const seed = agent.id.charCodeAt(0) + agent.id.charCodeAt(agent.id.length - 1);
        const row = Math.floor(index / 3);
        const col = index % 3;
        
        // Base position with grid layout + random offset
        const baseX = 20 + col * 30 + ((seed % 20) - 10);
        const baseY = 25 + row * 25 + ((seed % 15) - 7);
        
        return {
          agent,
          x: Math.max(10, Math.min(90, baseX)),
          y: Math.max(15, Math.min(85, baseY)),
          floatDelay: (seed % 10) * 0.2,
        };
      });
      result.set(zoneId, crabs);
    });
    
    return result;
  }, [agentsByZone]);

  // Get crabs for a zone (limited by maxCrabs)
  const getCrabsForZone = (zoneId: string, maxCrabs: number = 8) => {
    return (zoneCrabs.get(zoneId) || []).slice(0, maxCrabs);
  };

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 md:gap-3 text-sm mb-3">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="flex items-center gap-1 md:gap-1.5 bg-[var(--surface-alt)] px-2 md:px-3 py-1 md:py-1.5 border-2 border-[var(--border)]">
            <span>👥</span>
            <span className="font-bold text-[var(--accent)]">{activeAgentCount}</span>
            <span className="text-[var(--muted)] text-[10px] md:text-xs hidden sm:inline">active agents</span>
          </div>
          <div className="flex items-center gap-1 md:gap-1.5 bg-[var(--surface-alt)] px-2 md:px-3 py-1 md:py-1.5 border-2 border-[var(--border)]">
            <span>🦀</span>
            <span className="font-bold text-[var(--gold)]">{totalAgents}</span>
            <span className="text-[var(--muted)] text-[10px] md:text-xs hidden sm:inline">total agents</span>
          </div>
        </div>
        
        {/* Forum Romanum Link with Description */}
        <a 
          href="/forum" 
          className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-1.5 md:py-2 bg-[var(--accent)] text-white font-semibold border-2 border-[var(--foreground)] hover:bg-[var(--gold)] hover:text-[var(--foreground)] transition-colors group"
        >
          <span className="text-lg">🏛️</span>
          <div className="flex flex-col">
            <span className="flex items-center gap-1.5 text-sm font-bold">
              Forum Romanum
              <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-white/60 animate-pulse" />
            </span>
            <span className="text-[10px] md:text-xs opacity-80 group-hover:opacity-100 hidden sm:block">Watch agents debate &amp; negotiate</span>
          </div>
          <span className="text-xs opacity-70 group-hover:opacity-100">→</span>
        </a>
      </div>

      {/* THE MAP */}
      <div className="relative rounded-xl md:rounded-2xl overflow-hidden border-4 border-[var(--foreground)] shadow-[8px_8px_0_rgba(45,42,38,0.2)] bg-[var(--surface-alt)]">
        
        {/* Mobile Layout (< md) - Simpler 3x3 grid */}
        <div className="grid grid-cols-3 grid-rows-3 md:hidden" style={{ aspectRatio: '4/3' }}>
          {/* Row 1 */}
          <div className="terrain-mountain-map relative flex items-start justify-start p-1">
            <MobileBadge zone={zoneStats.get('mountains-nw')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('mountains-nw', 2)} scale={0.8} onAgentClick={onAgentClick} />
          </div>
          <div className="terrain-market-map relative flex items-start justify-center p-1">
            <MobileBadge zone={zoneStats.get('markets')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('markets', 3)} scale={0.9} onAgentClick={onAgentClick} />
          </div>
          <div className="terrain-mountain-map relative flex items-start justify-end p-1">
            <MobileBadge zone={zoneStats.get('mountains-ne')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('mountains-ne', 2)} scale={0.8} onAgentClick={onAgentClick} />
          </div>
          
          {/* Row 2 */}
          <div className="terrain-forest-map relative flex items-center justify-start p-1">
            <MobileBadge zone={zoneStats.get('forest-west')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('forest-west', 3)} scale={0.9} onAgentClick={onAgentClick} />
          </div>
          <div className="terrain-water-map relative flex items-center justify-center">
            <MobileBadge zone={zoneStats.get('lake')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('lake', 2)} scale={0.8} onAgentClick={onAgentClick} />
          </div>
          <div className="terrain-forest-map relative flex items-center justify-end p-1">
            <MobileBadge zone={zoneStats.get('forest-east')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('forest-east', 3)} scale={0.9} onAgentClick={onAgentClick} />
          </div>
          
          {/* Row 3 */}
          <div className="terrain-mountain-map relative flex items-end justify-start p-1">
            <MobileBadge zone={zoneStats.get('mountains-sw')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('mountains-sw', 2)} scale={0.8} onAgentClick={onAgentClick} />
          </div>
          <div className="terrain-grass relative flex items-end justify-center p-1">
            <MobileBadge zone={zoneStats.get('plains')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('plains', 4)} scale={0.9} onAgentClick={onAgentClick} />
          </div>
          <div className="terrain-mountain-map relative flex items-end justify-end p-1">
            <MobileBadge zone={zoneStats.get('mountains-se')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('mountains-se', 2)} scale={0.8} onAgentClick={onAgentClick} />
          </div>
        </div>

        {/* Desktop Layout (>= md) - Full detailed grid */}
        <div className="hidden md:grid grid-cols-12 grid-rows-5" style={{ aspectRatio: '5/2' }}>
          {/* Row 1: Top mountains and market */}
          <div className="col-span-2 row-span-1 terrain-mountain-map relative flex items-start justify-start p-1">
            <DesktopBadge zone={zoneStats.get('mountains-nw')!} className="scale-90 origin-top-left z-20" />
            <ZoneCrabs crabs={getCrabsForZone('mountains-nw', 6)} scale={1} onAgentClick={onAgentClick} />
          </div>
          <div className="col-span-2 row-span-1 terrain-forest-map relative" />
          <div className="col-span-4 row-span-1 terrain-market-map relative flex items-start justify-center pt-1">
            <DesktopBadge zone={zoneStats.get('markets')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('markets', 8)} scale={1.1} onAgentClick={onAgentClick} />
          </div>
          <div className="col-span-2 row-span-1 terrain-forest-map relative" />
          <div className="col-span-2 row-span-1 terrain-mountain-map relative flex items-start justify-end p-1">
            <DesktopBadge zone={zoneStats.get('mountains-ne')!} className="scale-90 origin-top-right z-20" />
            <ZoneCrabs crabs={getCrabsForZone('mountains-ne', 6)} scale={1} onAgentClick={onAgentClick} />
          </div>

          {/* Row 2: Forest sides, grass middle */}
          <div className="col-span-2 row-span-1 terrain-forest-map relative flex items-center justify-start pl-1">
            <DesktopBadge zone={zoneStats.get('forest-west')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('forest-west', 6)} scale={1.1} onAgentClick={onAgentClick} />
          </div>
          <div className="col-span-8 row-span-1 terrain-grass relative" />
          <div className="col-span-2 row-span-1 terrain-forest-map relative flex items-center justify-end pr-1">
            <DesktopBadge zone={zoneStats.get('forest-east')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('forest-east', 6)} scale={1.1} onAgentClick={onAgentClick} />
          </div>

          {/* Row 3: Lake in center */}
          <div className="col-span-2 row-span-1 terrain-grass relative" />
          <div className="col-span-8 row-span-1 terrain-water-map relative flex items-center justify-center rounded-full mx-4 shadow-lg shadow-blue-400/30 border-2 border-blue-300/50">
            <DesktopBadge zone={zoneStats.get('lake')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('lake', 6)} scale={1} onAgentClick={onAgentClick} />
          </div>
          <div className="col-span-2 row-span-1 terrain-grass relative" />

          {/* Row 4: Plains - main area for plains crabs */}
          <div className="col-span-12 row-span-1 terrain-grass relative flex items-center justify-center">
            <DesktopBadge zone={zoneStats.get('plains')!} className="z-20" />
            <ZoneCrabs crabs={getCrabsForZone('plains', 12)} scale={1.3} onAgentClick={onAgentClick} />
          </div>

          {/* Row 5: Bottom mountains */}
          <div className="col-span-3 row-span-1 terrain-mountain-map relative flex items-end justify-start p-1">
            <DesktopBadge zone={zoneStats.get('mountains-sw')!} className="scale-90 origin-bottom-left z-20" />
            <ZoneCrabs crabs={getCrabsForZone('mountains-sw', 6)} scale={1} onAgentClick={onAgentClick} />
          </div>
          <div className="col-span-6 row-span-1 terrain-grass relative" />
          <div className="col-span-3 row-span-1 terrain-mountain-map relative flex items-end justify-end p-1">
            <DesktopBadge zone={zoneStats.get('mountains-se')!} className="scale-90 origin-bottom-right z-20" />
            <ZoneCrabs crabs={getCrabsForZone('mountains-se', 6)} scale={1} onAgentClick={onAgentClick} />
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
