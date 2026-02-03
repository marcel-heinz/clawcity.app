'use client';

import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { AgentPublic, TerrainType, WORLD_SIZE } from '@/lib/types';

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
const PIXEL_SIZE = 5; // Each tile is 5px

export function WorldMapPixel({ agents, onAgentClick }: WorldMapPixelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tiles, setTiles] = useState<TileData[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredAgent, setHoveredAgent] = useState<AgentPublic | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Fetch all tiles (sampling at downsample rate)
  useEffect(() => {
    async function fetchTiles() {
      try {
        // Fetch tiles in a grid pattern to cover the entire world
        const allTiles: TileData[] = [];
        const chunkRadius = 60; // Fetch 120x120 chunks
        const step = chunkRadius * 2; // Move by full chunk width
        
        // Create a grid of fetch points to cover 500x500
        for (let centerY = chunkRadius; centerY < WORLD_SIZE; centerY += step) {
          for (let centerX = chunkRadius; centerX < WORLD_SIZE; centerX += step) {
            const response = await fetch(
              `/api/world/tiles?x=${centerX}&y=${centerY}&radius=${chunkRadius}`
            );
            const data = await response.json();
            if (data.success && data.data.tiles) {
              // Only keep tiles that align with our downsample grid
              const sampledTiles = data.data.tiles.filter(
                (t: TileData) => t.x % DOWNSAMPLE === 0 && t.y % DOWNSAMPLE === 0
              );
              allTiles.push(...sampledTiles);
            }
          }
        }
        
        // Deduplicate tiles (in case of overlapping chunks)
        const uniqueTiles = new Map<string, TileData>();
        allTiles.forEach(tile => {
          uniqueTiles.set(`${tile.x},${tile.y}`, tile);
        });
        
        setTiles(Array.from(uniqueTiles.values()));
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

    // Draw agent markers
    activeAgents.forEach((agent) => {
      const gridX = Math.floor(agent.x / DOWNSAMPLE);
      const gridY = Math.floor(agent.y / DOWNSAMPLE);
      
      // Draw a bright marker for agents
      ctx.fillStyle = '#ff4444';
      ctx.beginPath();
      ctx.arc(
        gridX * PIXEL_SIZE + PIXEL_SIZE / 2,
        gridY * PIXEL_SIZE + PIXEL_SIZE / 2,
        PIXEL_SIZE * 0.8,
        0,
        Math.PI * 2
      );
      ctx.fill();
      
      // White border for visibility
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }, [tileMap, activeAgents, loading]);

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

      {/* The Map Canvas */}
      <div className="relative rounded-xl md:rounded-2xl overflow-hidden border-4 border-[var(--foreground)] shadow-[8px_8px_0_rgba(45,42,38,0.2)] bg-[#0a0a0a]">
        <canvas
          ref={canvasRef}
          width={GRID_SIZE * PIXEL_SIZE}
          height={GRID_SIZE * PIXEL_SIZE}
          className="w-full cursor-crosshair"
          style={{ imageRendering: 'pixelated' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredAgent(null)}
          onClick={handleClick}
        />

        {/* Hover Tooltip */}
        {hoveredAgent && (
          <div
            className="fixed z-50 px-2 py-1 bg-[var(--foreground)] text-[var(--background)] text-xs font-bold rounded shadow-lg pointer-events-none"
            style={{
              left: mousePos.x + 10,
              top: mousePos.y - 30,
            }}
          >
            {hoveredAgent.name}
            <div className="text-[10px] font-normal opacity-80">
              ({hoveredAgent.x}, {hoveredAgent.y})
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
          <span className="w-3 h-3 md:w-4 md:h-4 rounded-full bg-[#ff4444] border border-white" /> Agent
        </span>
      </div>
    </div>
  );
}
