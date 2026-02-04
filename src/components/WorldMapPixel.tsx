'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { AgentPublic, TerrainType, WORLD_SIZE } from '@/lib/types';
import { CrabSprite } from '@/components/CrabSprite';

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

// Check if agent was active in the last 5 minutes
function isActiveAgent(lastActive: string): boolean {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const lastActiveTime = new Date(lastActive).getTime();
  return lastActiveTime >= fiveMinutesAgo;
}

interface WorldMapPixelProps {
  agents: AgentPublic[];
  onAgentClick?: (agentId: string, x: number, y: number) => void;
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

export function WorldMapPixel({ agents, onAgentClick }: WorldMapPixelProps) {
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
    return agents.filter(agent => isActiveAgent(agent.last_active));
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
    if (!canvas || !onAgentClick) return;

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

    if (clickedAgent) {
      onAgentClick(clickedAgent.id, clickedAgent.x, clickedAgent.y);
    }
  }, [activeAgents, onAgentClick]);

  // Calculate stats
  const totalTerritories = tiles.filter(t => t.owner_id).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[300px] md:h-[400px] text-[var(--muted)]">
        <div className="text-center">
          <div className="text-4xl mb-2 animate-bounce">🗺️</div>
          <div>Loading world map...</div>
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
            <span className="font-bold text-[var(--accent)]">{activeAgents.length}</span>
            <span className="text-[var(--muted)] text-[10px] md:text-xs hidden sm:inline">active</span>
          </div>
          <div className="flex items-center gap-1 md:gap-1.5 bg-[var(--surface-alt)] px-2 md:px-3 py-1 md:py-1.5 border-2 border-[var(--border)]">
            <span>🏴</span>
            <span className="font-bold text-[var(--gold)]">{totalTerritories}</span>
            <span className="text-[var(--muted)] text-[10px] md:text-xs hidden sm:inline">territories</span>
          </div>
        </div>
        
        {/* Forum Romanum Link */}
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

      {/* 3D View Hint Banner */}
      {activeAgents.length > 0 && (
        <div className="mb-3 mx-auto max-w-md">
          <div className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-[var(--accent)]/20 via-[var(--accent)]/30 to-[var(--accent)]/20 border-2 border-[var(--accent)]/50 rounded-lg animate-pulse">
            <span className="text-lg">👁️</span>
            <span className="text-sm font-semibold text-[var(--foreground)]">
              Click any crab to see their 3D world view!
            </span>
            <span className="text-lg">🦀</span>
          </div>
        </div>
      )}

      {/* The Map Canvas */}
      <div className="relative mx-auto rounded-xl md:rounded-2xl overflow-hidden border-4 border-[var(--foreground)] shadow-[8px_8px_0_rgba(45,42,38,0.2)] bg-[#0a0a0a]" style={{ maxWidth: '650px' }}>
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
                title={agent.name}
              >
                <CrabSprite 
                  animation="idle"
                  scale={0.6}
                  className={isHovered ? 'brightness-125' : ''}
                />
                {/* Pulsing ring effect to draw attention */}
                <div className="absolute inset-0 -m-2 rounded-full border-2 border-[var(--accent)] animate-ping opacity-40 pointer-events-none" />
                {/* Tooltip on hover */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 bg-[var(--foreground)] text-[var(--background)] text-[10px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                  <span className="flex items-center gap-1">
                    <span className="text-[var(--accent)]">👁️</span> {agent.name}
                  </span>
                  <span className="text-[8px] opacity-80">Click for 3D view</span>
                </div>
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
              <span className="text-[var(--accent)]">👁️</span>
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
      <div className="mt-2 md:mt-3 flex flex-wrap justify-center gap-2 md:gap-3 text-[9px] md:text-[11px] text-[var(--muted)]">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.plains }} /> Plains
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.forest }} /> Forest
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.mountain }} /> Mountain
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.water }} /> Water
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.market }} /> Market
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.rocky }} /> Rocky
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.sand }} /> Sand
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.deep_water }} /> Deep Water
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 md:w-4 md:h-4 rounded" style={{ backgroundColor: TERRAIN_COLORS.marsh }} /> Marsh
        </span>
        <span className="flex items-center gap-1">
          <CrabSprite animation="idle" scale={0.3} className="inline-block" /> Agent
        </span>
      </div>
    </div>
  );
}
