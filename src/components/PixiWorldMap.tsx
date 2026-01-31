'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Application, Container, Sprite, Texture, Graphics, Text, TextStyle } from 'pixi.js';
import { AgentPublic, Tile, WORLD_SIZE } from '@/lib/types';
import { TILE_SIZE, SCALE, VIEWPORT, PALETTE, getTileIndex } from '@/lib/tileset';

interface PixiWorldMapProps {
  agents: AgentPublic[];
  centerX?: number;
  centerY?: number;
  viewRadius?: number;
  onCenterChange?: (x: number, y: number) => void;
}

// Generate a simple colored tile texture
function createTileTexture(app: Application, color: string, variant: number = 0): Texture {
  const graphics = new Graphics();
  
  // Base color
  graphics.rect(0, 0, TILE_SIZE, TILE_SIZE);
  graphics.fill(color);
  
  // Add some pixel variation for visual interest
  if (variant > 0) {
    const darkerColor = adjustColor(color, -20);
    for (let i = 0; i < variant * 2; i++) {
      const px = Math.floor(Math.random() * TILE_SIZE);
      const py = Math.floor(Math.random() * TILE_SIZE);
      graphics.rect(px, py, 1, 1);
      graphics.fill(darkerColor);
    }
  }
  
  return app.renderer.generateTexture(graphics);
}

// Create a tree sprite texture
function createTreeTexture(app: Application, depleted: boolean = false): Texture {
  const graphics = new Graphics();
  
  if (depleted) {
    // Stump
    graphics.rect(6, 10, 4, 6);
    graphics.fill(PALETTE.stump);
    // Dead grass
    graphics.rect(0, 14, TILE_SIZE, 2);
    graphics.fill(PALETTE.grassDead);
  } else {
    // Tree trunk
    graphics.rect(6, 8, 4, 8);
    graphics.fill(PALETTE.treeTrunk);
    // Tree leaves (triangular shape)
    graphics.poly([8, 0, 2, 8, 14, 8]);
    graphics.fill(PALETTE.treeLeaves);
    graphics.poly([8, 2, 4, 7, 12, 7]);
    graphics.fill(PALETTE.treeLeavesDark);
  }
  
  return app.renderer.generateTexture(graphics);
}

// Create mountain/rock texture
function createMountainTexture(app: Application, depleted: boolean = false): Texture {
  const graphics = new Graphics();
  
  if (depleted) {
    // Crumbled rocks
    graphics.circle(4, 12, 3);
    graphics.fill(PALETTE.rockCrumbled);
    graphics.circle(10, 10, 4);
    graphics.fill(PALETTE.rock2);
    graphics.circle(12, 14, 2);
    graphics.fill(PALETTE.rockCrumbled);
  } else {
    // Mountain peak
    graphics.poly([8, 0, 0, 16, 16, 16]);
    graphics.fill(PALETTE.rock1);
    graphics.poly([8, 0, 4, 10, 12, 10]);
    graphics.fill(PALETTE.rockLight);
    // Snow cap
    graphics.poly([8, 0, 6, 4, 10, 4]);
    graphics.fill('#ffffff');
  }
  
  return app.renderer.generateTexture(graphics);
}

// Create water texture
function createWaterTexture(app: Application, frame: number = 0, depleted: boolean = false): Texture {
  const graphics = new Graphics();
  
  if (depleted) {
    // Dried riverbed
    graphics.rect(0, 0, TILE_SIZE, TILE_SIZE);
    graphics.fill(PALETTE.waterDried);
    // Cracks
    graphics.moveTo(2, 2);
    graphics.lineTo(6, 8);
    graphics.lineTo(4, 14);
    graphics.stroke({ width: 1, color: '#a08060' });
    graphics.moveTo(10, 4);
    graphics.lineTo(12, 10);
    graphics.stroke({ width: 1, color: '#a08060' });
  } else {
    // Animated water
    graphics.rect(0, 0, TILE_SIZE, TILE_SIZE);
    graphics.fill(PALETTE.water1);
    // Wave highlights (animated by frame)
    const offset = frame * 2;
    for (let i = 0; i < 3; i++) {
      const y = ((i * 5 + offset) % TILE_SIZE);
      graphics.rect(2 + i * 3, y, 4, 1);
      graphics.fill(PALETTE.waterShallow);
    }
  }
  
  return app.renderer.generateTexture(graphics);
}

// Create market building texture
function createMarketTexture(app: Application): Texture {
  const graphics = new Graphics();
  
  // Floor
  graphics.rect(0, 0, TILE_SIZE, TILE_SIZE);
  graphics.fill(PALETTE.grass1);
  
  // Building base
  graphics.rect(2, 4, 12, 12);
  graphics.fill(PALETTE.marketWall);
  
  // Roof
  graphics.poly([8, 0, 1, 5, 15, 5]);
  graphics.fill(PALETTE.marketRoof);
  
  // Door
  graphics.rect(6, 10, 4, 6);
  graphics.fill(PALETTE.marketDoor);
  
  // Sign
  graphics.rect(4, 6, 8, 3);
  graphics.fill('#ffd700');
  
  return app.renderer.generateTexture(graphics);
}

// Create agent sprite texture
function createAgentTexture(app: Application): Texture {
  const graphics = new Graphics();
  
  // Shadow
  graphics.ellipse(8, 14, 5, 2);
  graphics.fill({ color: 0x000000, alpha: 0.3 });
  
  // Body
  graphics.circle(8, 8, 5);
  graphics.fill(PALETTE.agentBody);
  graphics.stroke({ width: 1, color: PALETTE.agentOutline });
  
  // Eyes
  graphics.circle(6, 7, 1);
  graphics.fill('#ffffff');
  graphics.circle(10, 7, 1);
  graphics.fill('#ffffff');
  graphics.circle(6, 7, 0.5);
  graphics.fill('#000000');
  graphics.circle(10, 7, 0.5);
  graphics.fill('#000000');
  
  // Antenna/claw
  graphics.moveTo(5, 3);
  graphics.lineTo(3, 0);
  graphics.moveTo(11, 3);
  graphics.lineTo(13, 0);
  graphics.stroke({ width: 1, color: PALETTE.agentBody });
  
  return app.renderer.generateTexture(graphics);
}

// Adjust color brightness
function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0x0000ff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

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
  const texturesRef = useRef<Map<string, Texture>>(new Map());
  
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
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
    if (!containerRef.current) return;

    let app: Application;
    let destroyed = false;

    async function initPixi() {
      app = new Application();
      
      await app.init({
        width: VIEWPORT.pixelWidth,
        height: VIEWPORT.pixelHeight,
        backgroundColor: 0x1a1a2e,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (destroyed) {
        app.destroy(true);
        return;
      }

      containerRef.current?.appendChild(app.canvas);
      appRef.current = app;

      // Create containers
      const tilesContainer = new Container();
      const agentsContainer = new Container();
      
      app.stage.addChild(tilesContainer);
      app.stage.addChild(agentsContainer);
      
      tilesContainerRef.current = tilesContainer;
      agentsContainerRef.current = agentsContainer;

      // Generate textures
      const textures = new Map<string, Texture>();
      
      // Grass variants
      for (let i = 0; i < 4; i++) {
        textures.set(`plains_${i}`, createTileTexture(app, PALETTE.grass1, i));
        textures.set(`plains_depleted_${i}`, createTileTexture(app, PALETTE.grassDead, i));
      }
      
      // Forest
      textures.set('forest', createTreeTexture(app, false));
      textures.set('forest_depleted', createTreeTexture(app, true));
      
      // Mountain
      textures.set('mountain', createMountainTexture(app, false));
      textures.set('mountain_depleted', createMountainTexture(app, true));
      
      // Water (multiple frames for animation)
      for (let i = 0; i < 4; i++) {
        textures.set(`water_${i}`, createWaterTexture(app, i, false));
      }
      textures.set('water_depleted', createWaterTexture(app, 0, true));
      
      // Market
      textures.set('market', createMarketTexture(app));
      
      // Agent
      textures.set('agent', createAgentTexture(app));
      
      texturesRef.current = textures;

      // Water animation ticker
      let waterFrame = 0;
      app.ticker.add(() => {
        waterFrame = (waterFrame + 0.05) % 4;
      });
    }

    initPixi();

    return () => {
      destroyed = true;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, []);

  // Render tiles
  useEffect(() => {
    const tilesContainer = tilesContainerRef.current;
    const textures = texturesRef.current;
    
    if (!tilesContainer || textures.size === 0) return;

    // Clear existing tiles
    tilesContainer.removeChildren();

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

        // Get appropriate texture
        let texture: Texture | undefined;
        const variant = (worldX * 7 + worldY * 13) % 4; // Deterministic variation
        
        if (tile) {
          const depleted = tile.depleted || false;
          
          switch (tile.terrain) {
            case 'plains':
              texture = textures.get(`plains_${depleted ? 'depleted_' : ''}${variant}`);
              break;
            case 'forest':
              texture = textures.get(depleted ? 'forest_depleted' : 'forest');
              break;
            case 'mountain':
              texture = textures.get(depleted ? 'mountain_depleted' : 'mountain');
              break;
            case 'water':
              texture = textures.get(depleted ? 'water_depleted' : `water_${variant}`);
              break;
            case 'market':
              texture = textures.get('market');
              break;
          }

          // Add territory border if owned
          if (tile.owner_id) {
            const border = new Graphics();
            border.rect(dx * TILE_SIZE * SCALE, dy * TILE_SIZE * SCALE, TILE_SIZE * SCALE, TILE_SIZE * SCALE);
            border.stroke({ width: 2, color: 0xffd700 });
            border.fill({ color: 0xffd700, alpha: 0.15 });
            tilesContainer.addChild(border);
          }
        }

        if (texture) {
          const sprite = new Sprite(texture);
          sprite.x = dx * TILE_SIZE * SCALE;
          sprite.y = dy * TILE_SIZE * SCALE;
          sprite.scale.set(SCALE);
          tilesContainer.addChild(sprite);
        } else {
          // Fallback: dark tile for unknown/out of bounds
          const graphics = new Graphics();
          graphics.rect(dx * TILE_SIZE * SCALE, dy * TILE_SIZE * SCALE, TILE_SIZE * SCALE, TILE_SIZE * SCALE);
          graphics.fill(0x1a1a2e);
          tilesContainer.addChild(graphics);
        }
      }
    }
  }, [tiles, centerX, centerY]);

  // Render agents
  useEffect(() => {
    const agentsContainer = agentsContainerRef.current;
    const textures = texturesRef.current;
    
    if (!agentsContainer || textures.size === 0) return;

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
        const agentTexture = textures.get('agent');
        if (agentTexture) {
          const sprite = new Sprite(agentTexture);
          sprite.x = screenX * TILE_SIZE * SCALE;
          sprite.y = screenY * TILE_SIZE * SCALE;
          sprite.scale.set(SCALE);
          agentsContainer.addChild(sprite);

          // Name label
          const style = new TextStyle({
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
            fill: '#ffffff',
            stroke: { color: '#000000', width: 2 },
          });
          const nameText = new Text({ text: agent.name, style });
          nameText.x = screenX * TILE_SIZE * SCALE + (TILE_SIZE * SCALE) / 2;
          nameText.y = screenY * TILE_SIZE * SCALE - 12;
          nameText.anchor.set(0.5, 1);
          agentsContainer.addChild(nameText);
        }
      }
    });
  }, [agents, centerX, centerY]);

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
      <div className="flex items-center justify-center h-full text-[var(--muted)]">
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
          <span className="w-3 h-3 rounded" style={{ backgroundColor: PALETTE.grass1 }} /> Plains
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: PALETTE.treeLeaves }} /> Forest
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: PALETTE.rock1 }} /> Mountain
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: PALETTE.marketRoof }} /> Market
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: PALETTE.water1 }} /> Water
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: PALETTE.agentBody }} /> Agent
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded border-2" style={{ borderColor: PALETTE.territoryBorder, backgroundColor: 'transparent' }} /> Territory
        </span>
      </div>
    </div>
  );
}
