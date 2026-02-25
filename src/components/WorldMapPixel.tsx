'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { AgentPublic, TerrainType, WORLD_SIZE } from '@/lib/types';
import { CrabSprite } from '@/components/CrabSprite';
import { resolveAvatar } from '@/lib/avatar';
import { isAgentOnline } from '@/lib/presence';

// Terrain colors matching terrain-demo.html
const TERRAIN_COLORS: Record<TerrainType, string> = {
  plains: '#90a955',
  forest: '#386641',
  mountain: '#6c757d',
  market: '#ffd700',
  water: '#4361ee',
  rocky: '#495057',
  sand: '#e9c46a',
  deep_water: '#1d3557',
  marsh: '#457b9d',
};

// Shared presence signal from world/status (with local fallback).
function isActiveAgent(agent: AgentPublic): boolean {
  return isAgentOnline(agent);
}

interface WorldMapPixelProps {
  agents: AgentPublic[];
  onlineCount?: number;
  onAgentClick?: (agentId: string, x: number, y: number) => void;
  onMapClick?: (x: number, y: number) => void;
  isConnected?: boolean;
}

interface TileData {
  x: number;
  y: number;
  terrain: TerrainType;
  owner_id?: string;
}

// Downsample factor (500/100 = 5)
const DOWNSAMPLE = 5;
const GRID_SIZE = WORLD_SIZE / DOWNSAMPLE; // 100x100
const PIXEL_SIZE = 4; // Each tile is 4px (total 400px width)

export function WorldMapPixel({ agents, onlineCount, onAgentClick, onMapClick, isConnected = true }: WorldMapPixelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tiles, setTiles] = useState<TileData[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredAgent, setHoveredAgent] = useState<AgentPublic | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Fetch tiles with server-side sampling
  useEffect(() => {
    async function fetchTiles() {
      try {
        // Fetch entire world with server-side sampling
        // radius=260 covers 0-520 from center 250, sample=5 means every 5th tile
        const response = await fetch(
          `/api/world/tiles?x=250&y=250&radius=260&sample=${DOWNSAMPLE}`
        );
        const data = await response.json();
        
        if (data.success && data.data.tiles) {
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

  // Create tile lookup map
  const tileMap = useMemo(() => {
    const map = new Map<string, TileData>();
    tiles.forEach((tile) => {
      // Convert to grid coordinates
      const gridX = Math.floor(tile.x / DOWNSAMPLE);
      const gridY = Math.floor(tile.y / DOWNSAMPLE);
      map.set(`${gridX},${gridY}`, tile);
    });
    return map;
  }, [tiles]);

  // Filter to only active agents
  const activeAgents = useMemo(() => {
    return agents.filter(agent => isActiveAgent(agent));
  }, [agents]);

  // Draw the map
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || loading) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw terrain
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const tile = tileMap.get(`${x},${y}`);
        const color = tile ? TERRAIN_COLORS[tile.terrain] || '#333' : '#1a1a2e';
        
        ctx.fillStyle = color;
        ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
      }
    }
  }, [tileMap, loading]);

  // Handle mouse interactions
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;
    
    const gridX = Math.floor(canvasX / PIXEL_SIZE);
    const gridY = Math.floor(canvasY / PIXEL_SIZE);

    setMousePos({ x: e.clientX, y: e.clientY });

    // Check if hovering over an agent
    const hoveredAgentFound = activeAgents.find((agent) => {
      const agentGridX = Math.floor(agent.x / DOWNSAMPLE);
      const agentGridY = Math.floor(agent.y / DOWNSAMPLE);
      return agentGridX === gridX && agentGridY === gridY;
    });

    setHoveredAgent(hoveredAgentFound || null);
  }, [activeAgents]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    const gridX = Math.floor(canvasX / PIXEL_SIZE);
    const gridY = Math.floor(canvasY / PIXEL_SIZE);

    // Find clicked agent
    const clickedAgent = activeAgents.find((agent) => {
      const agentGridX = Math.floor(agent.x / DOWNSAMPLE);
      const agentGridY = Math.floor(agent.y / DOWNSAMPLE);
      return agentGridX === gridX && agentGridY === gridY;
    });

    if (clickedAgent && onAgentClick) {
      onAgentClick(clickedAgent.id, clickedAgent.x, clickedAgent.y);
    } else if (!clickedAgent && onMapClick) {
      // Clicked empty space - convert grid coords to world coords
      const worldX = gridX * DOWNSAMPLE + Math.floor(DOWNSAMPLE / 2);
      const worldY = gridY * DOWNSAMPLE + Math.floor(DOWNSAMPLE / 2);
      onMapClick(worldX, worldY);
    }
  }, [activeAgents, onAgentClick, onMapClick]);

  // Calculate stats
  const displayedOnlineCount = typeof onlineCount === 'number' ? onlineCount : activeAgents.length;
  const totalAgents = agents.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[300px] md:h-[400px] text-[var(--muted)]">
        <div className="text-center">
          <div className="text-4xl mb-2 animate-bounce">🗺️</div>
          <div>{isConnected ? 'Loading world map...' : 'Waiting for live world map data...'}</div>
          {!isConnected && (
            <div className="text-xs mt-1">Static previews do not include realtime map tiles.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Stats + follow hint header */}
      <div className="mb-3 flex w-full max-w-[560px] items-center gap-1.5 text-sm">
        <div className="flex h-9 shrink-0 items-center gap-1 border-2 border-[var(--border)] bg-[var(--surface-alt)] px-2">
          <span>🦀</span>
          <span className="font-bold text-[var(--gold)]">{totalAgents}</span>
          <span className="hidden whitespace-nowrap text-[10px] text-[var(--muted)] sm:inline md:text-xs">total agents</span>
        </div>
        <div className="flex h-9 shrink-0 items-center gap-1 border-2 border-[var(--border)] bg-[var(--surface-alt)] px-2">
          <span>👥</span>
          <span className="font-bold text-[var(--accent)]">{displayedOnlineCount}</span>
          <span className="hidden whitespace-nowrap text-[10px] text-[var(--muted)] sm:inline md:text-xs">active agents</span>
        </div>
        <div className="flex h-9 min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden rounded-md border-2 border-[var(--accent)]/50 bg-gradient-to-r from-[var(--accent)]/20 via-[var(--accent)]/30 to-[var(--accent)]/20 px-1.5 text-center sm:max-w-[260px]">
          <span className="text-xs leading-none">👁️</span>
          <span className="truncate text-[10px] font-semibold leading-tight text-[var(--foreground)] sm:text-[11px]">
            Click an agent or click the map.
          </span>
          <span className="text-xs leading-none">🗺️</span>
        </div>
      </div>

      {/* The Map Canvas */}
      <div className="relative w-full max-w-[560px] rounded-xl md:rounded-2xl overflow-hidden border-4 border-[var(--foreground)] shadow-[8px_8px_0_rgba(45,42,38,0.2)] bg-[#0a0a0a]">
        <canvas
          ref={canvasRef}
          width={GRID_SIZE * PIXEL_SIZE}
          height={GRID_SIZE * PIXEL_SIZE}
          className="w-full h-auto cursor-crosshair"
          style={{ imageRendering: 'pixelated', aspectRatio: '1/1' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredAgent(null)}
          onClick={handleClick}
        />

        {/* Sprite Overlay - Animated Crab Sprites */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{ aspectRatio: '1/1' }}
        >
          {activeAgents.map((agent) => {
            const gridX = Math.floor(agent.x / DOWNSAMPLE);
            const gridY = Math.floor(agent.y / DOWNSAMPLE);
            const isHovered = hoveredAgent?.id === agent.id;
            
            // Position sprite at center of grid cell using percentage
            // Each grid cell is 1% of the canvas (100 cells = 100%)
            const leftPercent = (gridX / GRID_SIZE) * 100 + (0.5 / GRID_SIZE) * 100;
            const topPercent = (gridY / GRID_SIZE) * 100 + (0.5 / GRID_SIZE) * 100;
            
            return (
              <div
                key={agent.id}
                className="absolute pointer-events-auto cursor-pointer group"
                style={{
                  left: `${leftPercent}%`,
                  top: `${topPercent}%`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: isHovered ? 20 : 10,
                }}
                onMouseEnter={(e) => {
                  setHoveredAgent(agent);
                  setMousePos({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => {
                  setMousePos({ x: e.clientX, y: e.clientY });
                }}
                onMouseLeave={() => setHoveredAgent(null)}
                onClick={() => {
                  if (onAgentClick) {
                    onAgentClick(agent.id, agent.x, agent.y);
                  }
                }}
              >
                {/* Colored ring from avatar */}
                <div
                  className="absolute inset-0 -m-1 rounded-full opacity-70 pointer-events-none"
                  style={{ border: `2px solid ${resolveAvatar(agent.name, agent.avatar).body_color}` }}
                />
                <CrabSprite
                  animation="idle"
                  scale={0.6}
                  className={isHovered ? 'brightness-125' : ''}
                />
                {/* Pulsing ring effect with agent color */}
                <div
                  className="absolute inset-0 -m-2 rounded-full border-2 animate-ping opacity-40 pointer-events-none"
                  style={{ borderColor: resolveAvatar(agent.name, agent.avatar).body_color }}
                />
              </div>
            );
          })}
        </div>

        {/* Hover Tooltip */}
        {hoveredAgent && (
          <div
            className="fixed z-50 px-2 py-1 bg-[var(--foreground)] text-[var(--background)] text-xs font-bold rounded shadow-lg pointer-events-none"
            style={{
              left: mousePos.x + 10,
              top: mousePos.y - 30,
            }}
          >
            <div className="flex items-center gap-1">
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: resolveAvatar(hoveredAgent.name, hoveredAgent.avatar).body_color }}
              />
              {hoveredAgent.name}
            </div>
            <div className="text-[10px] font-normal opacity-80">
              ({hoveredAgent.x}, {hoveredAgent.y})
            </div>
            <div className="text-[9px] font-normal text-[var(--accent)] mt-0.5">
              Click to see 3D view
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-2 w-full max-w-[560px] flex flex-nowrap items-center justify-start gap-1.5 whitespace-nowrap text-[8px] sm:text-[9px] md:text-[11px] text-[var(--muted)]">
        <span className="flex shrink-0 items-center gap-1">
          <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.plains }} />
          <span className="sm:hidden">Pl</span>
          <span className="hidden sm:inline">Plains</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.forest }} />
          <span className="sm:hidden">Fo</span>
          <span className="hidden sm:inline">Forest</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.mountain }} />
          <span className="sm:hidden">Mo</span>
          <span className="hidden sm:inline">Mountain</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.water }} />
          <span className="sm:hidden">Wa</span>
          <span className="hidden sm:inline">Water</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.market }} />
          <span className="sm:hidden">Mk</span>
          <span className="hidden sm:inline">Market</span>
        </span>
        <span className="hidden sm:flex shrink-0 items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.rocky }} /> Rocky
        </span>
        <span className="hidden sm:flex shrink-0 items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.sand }} /> Sand
        </span>
        <span className="hidden sm:flex shrink-0 items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.deep_water }} /> Deep Water
        </span>
        <span className="hidden sm:flex shrink-0 items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.marsh }} /> Marsh
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <CrabSprite animation="idle" scale={0.3} className="inline-block" /> Agent
        </span>
      </div>
    </div>
  );
}
