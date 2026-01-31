'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { AgentPublic, Tile, WORLD_SIZE } from '@/lib/types';
import { TILE_SIZE, SCALE, VIEWPORT, PALETTE } from '@/lib/tileset';

interface PixiWorldMapProps {
  agents: AgentPublic[];
  centerX?: number;
  centerY?: number;
  viewRadius?: number;
  onCenterChange?: (x: number, y: number) => void;
}

// Convert hex string to number
function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// Terrain colors as numbers
const COLORS = {
  grass: [0x7ec850, 0x6db840, 0x5ea830, 0x4e9820],
  grassDead: [0xb8a060, 0xa89050, 0x988040, 0x887030],
  forest: 0x228b22,
  forestDark: 0x1a6b1a,
  trunk: 0x8b5a2b,
  stump: 0x6b4423,
  rock: [0x808080, 0x707070, 0x606060, 0x505050],
  rockLight: 0xa0a0a0,
  snow: 0xffffff,
  water: [0x4a90d9, 0x3a80c9, 0x4a90d9, 0x5aa0e9],
  waterDried: 0xc4a882,
  market: 0xcc6633,
  marketWall: 0xf5deb3,
  marketDoor: 0x8b4513,
  agent: 0xff6b6b,
  agentOutline: 0x333333,
  territory: 0xffd700,
  background: 0x1a1a2e,
};

export function PixiWorldMap({
  agents,
  centerX = Math.floor(WORLD_SIZE / 2),
  centerY = Math.floor(WORLD_SIZE / 2),
  onCenterChange,
}: PixiWorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const tilesContainerRef = useRef<Container | null>(null);
  const agentsContainerRef = useRef<Container | null>(null);
  
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(null);

  // Fetch tiles from API
  useEffect(() => {
    async function fetchTiles() {
      try {
        const viewRadius = Math.max(VIEWPORT.tilesWide, VIEWPORT.tilesHigh);
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
  }, [centerX, centerY]);

  // Initialize PixiJS
  useEffect(() => {
    if (!containerRef.current || isInitialized) return;

    let app: Application;
    let destroyed = false;

    async function initPixi() {
      app = new Application();
      
      await app.init({
        width: VIEWPORT.pixelWidth,
        height: VIEWPORT.pixelHeight,
        backgroundColor: COLORS.background,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        antialias: false,
      });

      if (destroyed) {
        app.destroy(true);
        return;
      }

      // Clear container and add canvas
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(app.canvas);
      }
      
      appRef.current = app;

      // Create containers
      const tilesContainer = new Container();
      const agentsContainer = new Container();
      
      app.stage.addChild(tilesContainer);
      app.stage.addChild(agentsContainer);
      
      tilesContainerRef.current = tilesContainer;
      agentsContainerRef.current = agentsContainer;
      
      setIsInitialized(true);
    }

    initPixi();

    return () => {
      destroyed = true;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
        tilesContainerRef.current = null;
        agentsContainerRef.current = null;
        setIsInitialized(false);
      }
    };
  }, []);

  // Draw a single tile
  const drawTile = useCallback((
    graphics: Graphics,
    x: number,
    y: number,
    terrain: string,
    depleted: boolean,
    owned: boolean,
    seed: number
  ) => {
    const px = x * TILE_SIZE * SCALE;
    const py = y * TILE_SIZE * SCALE;
    const size = TILE_SIZE * SCALE;
    const variant = seed % 4;

    // Draw base terrain
    switch (terrain) {
      case 'plains':
        if (depleted) {
          graphics.rect(px, py, size, size).fill(COLORS.grassDead[variant]);
          // Cracks
          graphics.moveTo(px + 4, py + 4).lineTo(px + 12, py + 20).stroke({ width: 1, color: 0x907040 });
          graphics.moveTo(px + 20, py + 8).lineTo(px + 16, py + 24).stroke({ width: 1, color: 0x907040 });
        } else {
          graphics.rect(px, py, size, size).fill(COLORS.grass[variant]);
          // Grass details
          if (variant === 0) {
            graphics.rect(px + 8, py + 12, 2, 4).fill(0x5ea030);
            graphics.rect(px + 20, py + 8, 2, 4).fill(0x5ea030);
          }
        }
        break;

      case 'forest':
        // Ground
        graphics.rect(px, py, size, size).fill(depleted ? COLORS.grassDead[0] : COLORS.grass[1]);
        
        if (depleted) {
          // Stump
          graphics.rect(px + 10, py + 18, 12, 10).fill(COLORS.stump);
          graphics.rect(px + 8, py + 16, 16, 4).fill(COLORS.trunk);
        } else {
          // Tree trunk
          graphics.rect(px + 12, py + 16, 8, 14).fill(COLORS.trunk);
          // Tree canopy (layered circles for fullness)
          graphics.circle(px + 16, py + 12, 10).fill(COLORS.forest);
          graphics.circle(px + 12, py + 10, 7).fill(COLORS.forestDark);
          graphics.circle(px + 20, py + 10, 7).fill(COLORS.forestDark);
          graphics.circle(px + 16, py + 6, 6).fill(COLORS.forest);
        }
        break;

      case 'mountain':
        // Base
        graphics.rect(px, py, size, size).fill(depleted ? COLORS.grassDead[0] : COLORS.grass[2]);
        
        if (depleted) {
          // Crumbled rocks
          graphics.circle(px + 8, py + 22, 6).fill(COLORS.rock[2]);
          graphics.circle(px + 20, py + 18, 8).fill(COLORS.rock[1]);
          graphics.circle(px + 26, py + 24, 5).fill(COLORS.rock[3]);
        } else {
          // Mountain triangle
          graphics.poly([px + 16, py + 2, px + 2, py + 30, px + 30, py + 30]).fill(COLORS.rock[variant]);
          // Highlight
          graphics.poly([px + 16, py + 2, px + 10, py + 16, px + 22, py + 16]).fill(COLORS.rockLight);
          // Snow cap
          graphics.poly([px + 16, py + 2, px + 13, py + 8, px + 19, py + 8]).fill(COLORS.snow);
        }
        break;

      case 'water':
        if (depleted) {
          graphics.rect(px, py, size, size).fill(COLORS.waterDried);
          // Dried cracks
          graphics.moveTo(px + 6, py + 6).lineTo(px + 14, py + 18).stroke({ width: 2, color: 0xa08060 });
          graphics.moveTo(px + 22, py + 10).lineTo(px + 18, py + 26).stroke({ width: 2, color: 0xa08060 });
        } else {
          graphics.rect(px, py, size, size).fill(COLORS.water[variant]);
          // Wave highlights
          graphics.rect(px + 4, py + 8, 8, 2).fill(0x6ab0e9);
          graphics.rect(px + 16, py + 16, 10, 2).fill(0x6ab0e9);
          graphics.rect(px + 8, py + 24, 6, 2).fill(0x6ab0e9);
        }
        break;

      case 'market':
        // Ground
        graphics.rect(px, py, size, size).fill(COLORS.grass[0]);
        // Building
        graphics.rect(px + 4, py + 10, 24, 20).fill(COLORS.marketWall);
        // Roof
        graphics.poly([px + 16, py + 2, px + 2, py + 12, px + 30, py + 12]).fill(COLORS.market);
        // Door
        graphics.rect(px + 12, py + 20, 8, 10).fill(COLORS.marketDoor);
        // Sign
        graphics.rect(px + 8, py + 14, 16, 4).fill(0xffd700);
        break;

      default:
        graphics.rect(px, py, size, size).fill(COLORS.background);
    }

    // Territory border
    if (owned) {
      graphics.rect(px + 1, py + 1, size - 2, size - 2).stroke({ width: 2, color: COLORS.territory });
    }
  }, []);

  // Render tiles
  useEffect(() => {
    const tilesContainer = tilesContainerRef.current;
    
    if (!tilesContainer || !isInitialized) return;

    // Clear existing tiles
    tilesContainer.removeChildren();

    // Create a single graphics object for all tiles (better performance)
    const graphics = new Graphics();

    // Create tile map for quick lookup
    const tileMap = new Map<string, Tile>();
    tiles.forEach((tile) => {
      tileMap.set(`${tile.x},${tile.y}`, tile);
    });

    // Calculate view bounds
    const halfWidth = Math.floor(VIEWPORT.tilesWide / 2);
    const halfHeight = Math.floor(VIEWPORT.tilesHigh / 2);
    const minX = centerX - halfWidth;
    const minY = centerY - halfHeight;

    // Render visible tiles
    for (let dy = 0; dy < VIEWPORT.tilesHigh; dy++) {
      for (let dx = 0; dx < VIEWPORT.tilesWide; dx++) {
        const worldX = minX + dx;
        const worldY = minY + dy;
        const key = `${worldX},${worldY}`;
        const tile = tileMap.get(key);

        const seed = (worldX * 7 + worldY * 13) % 100;
        
        if (tile) {
          drawTile(
            graphics,
            dx,
            dy,
            tile.terrain,
            tile.depleted || false,
            !!tile.owner_id,
            seed
          );
        } else {
          // Out of bounds or unknown tile
          graphics.rect(
            dx * TILE_SIZE * SCALE,
            dy * TILE_SIZE * SCALE,
            TILE_SIZE * SCALE,
            TILE_SIZE * SCALE
          ).fill(COLORS.background);
        }
      }
    }

    tilesContainer.addChild(graphics);
  }, [tiles, centerX, centerY, isInitialized, drawTile]);

  // Render agents
  useEffect(() => {
    const agentsContainer = agentsContainerRef.current;
    
    if (!agentsContainer || !isInitialized) return;

    // Clear existing agents
    agentsContainer.removeChildren();

    const halfWidth = Math.floor(VIEWPORT.tilesWide / 2);
    const halfHeight = Math.floor(VIEWPORT.tilesHigh / 2);
    const minX = centerX - halfWidth;
    const minY = centerY - halfHeight;

    // Render agents in view
    agents.forEach((agent) => {
      const screenX = agent.x - minX;
      const screenY = agent.y - minY;

      // Check if agent is in view
      if (screenX >= 0 && screenX < VIEWPORT.tilesWide && screenY >= 0 && screenY < VIEWPORT.tilesHigh) {
        const graphics = new Graphics();
        const px = screenX * TILE_SIZE * SCALE;
        const py = screenY * TILE_SIZE * SCALE;

        // Shadow
        graphics.ellipse(px + 16, py + 28, 10, 4).fill({ color: 0x000000, alpha: 0.3 });
        
        // Body
        graphics.circle(px + 16, py + 16, 10).fill(COLORS.agent);
        graphics.circle(px + 16, py + 16, 10).stroke({ width: 2, color: COLORS.agentOutline });
        
        // Eyes
        graphics.circle(px + 12, py + 14, 2).fill(0xffffff);
        graphics.circle(px + 20, py + 14, 2).fill(0xffffff);
        graphics.circle(px + 12, py + 14, 1).fill(0x000000);
        graphics.circle(px + 20, py + 14, 1).fill(0x000000);
        
        // Antennae (claw-like)
        graphics.moveTo(px + 10, py + 6).lineTo(px + 6, py + 0).stroke({ width: 2, color: COLORS.agent });
        graphics.moveTo(px + 22, py + 6).lineTo(px + 26, py + 0).stroke({ width: 2, color: COLORS.agent });

        agentsContainer.addChild(graphics);

        // Name label
        const style = new TextStyle({
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10,
          fill: 0xffffff,
          stroke: { color: 0x000000, width: 3 },
        });
        const nameText = new Text({ text: agent.name, style });
        nameText.x = px + 16;
        nameText.y = py - 8;
        nameText.anchor.set(0.5, 1);
        agentsContainer.addChild(nameText);
      }
    });
  }, [agents, centerX, centerY, isInitialized]);

  // Mouse drag handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      centerX,
      centerY,
    };
  }, [centerX, centerY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !dragStartRef.current || !onCenterChange) return;

    const dx = (e.clientX - dragStartRef.current.x) / (TILE_SIZE * SCALE);
    const dy = (e.clientY - dragStartRef.current.y) / (TILE_SIZE * SCALE);

    const newX = Math.max(0, Math.min(WORLD_SIZE - 1, Math.round(dragStartRef.current.centerX - dx)));
    const newY = Math.max(0, Math.min(WORLD_SIZE - 1, Math.round(dragStartRef.current.centerY - dy)));

    onCenterChange(newX, newY);
  }, [isDragging, onCenterChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  if (loading && tiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-[480px] text-[var(--muted)]">
        Loading world...
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="pixi-container cursor-grab active:cursor-grabbing rounded-lg overflow-hidden border border-[var(--border)]"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          width: VIEWPORT.pixelWidth,
          height: VIEWPORT.pixelHeight,
          imageRendering: 'pixelated',
        }}
      />
      
      {/* Coordinates overlay */}
      <div className="absolute top-2 left-2 bg-black/70 px-2 py-1 rounded text-xs text-[var(--muted)]">
        ({centerX}, {centerY})
      </div>
      
      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-[var(--muted)]">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: '#7ec850' }} /> Plains
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: '#228b22' }} /> Forest
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: '#808080' }} /> Mountain
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: '#cc6633' }} /> Market
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: '#4a90d9' }} /> Water
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: '#ff6b6b' }} /> Agent
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded border-2" style={{ borderColor: '#ffd700', backgroundColor: 'transparent' }} /> Territory
        </span>
      </div>
    </div>
  );
}
