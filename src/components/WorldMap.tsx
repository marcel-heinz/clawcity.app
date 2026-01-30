'use client';

import { useEffect, useState } from 'react';
import { AgentPublic, Tile, TERRAIN_SYMBOLS, WORLD_SIZE } from '@/lib/types';
import { getTerrainColorClass } from '@/lib/game-logic';

interface WorldMapProps {
  agents: AgentPublic[];
  centerX?: number;
  centerY?: number;
  viewRadius?: number;
}

export function WorldMap({ 
  agents, 
  centerX = 25, 
  centerY = 25, 
  viewRadius = 15 
}: WorldMapProps) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTiles() {
      try {
        const response = await fetch(
          `/api/world/tiles?x=${centerX}&y=${centerY}&radius=${viewRadius}`
        );
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
  }, [centerX, centerY, viewRadius]);

  // Create agent position map for quick lookup
  const agentPositions = new Map<string, AgentPublic[]>();
  agents.forEach((agent) => {
    const key = `${agent.x},${agent.y}`;
    const existing = agentPositions.get(key) || [];
    agentPositions.set(key, [...existing, agent]);
  });

  // Create tile map for quick lookup
  const tileMap = new Map<string, Tile>();
  tiles.forEach((tile) => {
    tileMap.set(`${tile.x},${tile.y}`, tile);
  });

  // Calculate view bounds
  const minX = Math.max(0, centerX - viewRadius);
  const maxX = Math.min(WORLD_SIZE - 1, centerX + viewRadius);
  const minY = Math.max(0, centerY - viewRadius);
  const maxY = Math.min(WORLD_SIZE - 1, centerY + viewRadius);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--muted)]">
        Loading world...
      </div>
    );
  }

  return (
    <div className="font-mono text-xs leading-none select-none">
      {/* Coordinate header */}
      <div className="flex mb-1 text-[var(--muted)]">
        <span className="w-6"></span>
        {Array.from({ length: maxX - minX + 1 }, (_, i) => (
          <span key={i} className="w-5 text-center">
            {(minX + i) % 10 === 0 ? minX + i : ''}
          </span>
        ))}
      </div>
      
      {/* Map grid */}
      {Array.from({ length: maxY - minY + 1 }, (_, rowIndex) => {
        const y = minY + rowIndex;
        return (
          <div key={y} className="flex items-center">
            {/* Row label */}
            <span className="w-6 text-[var(--muted)] text-right pr-1">
              {y % 5 === 0 ? y : ''}
            </span>
            
            {/* Tiles */}
            {Array.from({ length: maxX - minX + 1 }, (_, colIndex) => {
              const x = minX + colIndex;
              const key = `${x},${y}`;
              const tile = tileMap.get(key);
              const agentsHere = agentPositions.get(key) || [];
              
              // Determine what to display
              let symbol = '?';
              let colorClass = 'text-[var(--muted)]';
              let title = `(${x}, ${y})`;
              
              if (agentsHere.length > 0) {
                // Show agent indicator
                if (agentsHere.length === 1) {
                  symbol = '@';
                  title = `${agentsHere[0].name} at (${x}, ${y})`;
                } else {
                  symbol = agentsHere.length > 9 ? '+' : String(agentsHere.length);
                  title = `${agentsHere.length} agents at (${x}, ${y}): ${agentsHere.map(a => a.name).join(', ')}`;
                }
                colorClass = 'text-[var(--accent)] font-bold';
              } else if (tile) {
                symbol = TERRAIN_SYMBOLS[tile.terrain as keyof typeof TERRAIN_SYMBOLS] || '?';
                colorClass = getTerrainColorClass(tile.terrain as keyof typeof TERRAIN_SYMBOLS);
                title = `${tile.terrain} at (${x}, ${y})`;
              }
              
              return (
                <span
                  key={key}
                  className={`w-5 text-center cursor-default ${colorClass} hover:bg-[var(--surface)] transition-colors`}
                  title={title}
                >
                  {symbol}
                </span>
              );
            })}
          </div>
        );
      })}
      
      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-4 text-[10px] text-[var(--muted)]">
        <span><span className="terrain-plains">.</span> Plains</span>
        <span><span className="terrain-forest">♣</span> Forest</span>
        <span><span className="terrain-mountain">▲</span> Mountain</span>
        <span><span className="terrain-market">◆</span> Market</span>
        <span><span className="terrain-water">~</span> Water</span>
        <span><span className="text-[var(--accent)]">@</span> Agent</span>
      </div>
    </div>
  );
}
