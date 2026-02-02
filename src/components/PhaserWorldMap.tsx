'use client';

import { useEffect, useRef, useState } from 'react';
import { AgentPublic } from '@/lib/types';

interface PhaserWorldMapProps {
  agents: AgentPublic[];
  width?: number;
  height?: number;
}

// Zone definitions for the overview
const ZONES = [
  { id: 'mountains-nw', name: 'N. Peaks', x: 0, y: 0, w: 2, h: 1, terrain: 'mountain' },
  { id: 'forest-nw', name: '', x: 2, y: 0, w: 2, h: 1, terrain: 'forest' },
  { id: 'markets', name: 'Market', x: 4, y: 0, w: 4, h: 2, terrain: 'market' },
  { id: 'forest-ne', name: '', x: 8, y: 0, w: 2, h: 1, terrain: 'forest' },
  { id: 'mountains-ne', name: 'E. Cliffs', x: 10, y: 0, w: 2, h: 1, terrain: 'mountain' },
  
  { id: 'forest-west', name: 'W. Woods', x: 0, y: 1, w: 2, h: 2, terrain: 'forest' },
  { id: 'grass-1', name: '', x: 2, y: 1, w: 2, h: 1, terrain: 'grass' },
  { id: 'grass-2', name: '', x: 8, y: 1, w: 2, h: 1, terrain: 'grass' },
  { id: 'forest-east', name: 'E. Grove', x: 10, y: 1, w: 2, h: 2, terrain: 'forest' },
  
  { id: 'grass-3', name: '', x: 2, y: 2, w: 2, h: 1, terrain: 'grass' },
  { id: 'lake', name: 'Lake', x: 4, y: 2, w: 4, h: 2, terrain: 'water' },
  { id: 'grass-4', name: '', x: 8, y: 2, w: 2, h: 1, terrain: 'grass' },
  
  { id: 'mountains-sw', name: 'S. Range', x: 0, y: 3, w: 2, h: 1, terrain: 'mountain' },
  { id: 'grass-5', name: '', x: 2, y: 3, w: 2, h: 1, terrain: 'grass' },
  { id: 'grass-6', name: '', x: 8, y: 3, w: 2, h: 1, terrain: 'grass' },
  { id: 'mountains-se', name: 'Dragon', x: 10, y: 3, w: 2, h: 1, terrain: 'mountain' },
  
  { id: 'plains', name: 'Plains', x: 2, y: 4, w: 8, h: 1, terrain: 'grass' },
];

export function PhaserWorldMap({ agents, width = 800, height = 400 }: PhaserWorldMapProps) {
  const gameRef = useRef<HTMLDivElement>(null);
  const phaserGameRef = useRef<Phaser.Game | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!gameRef.current || phaserGameRef.current) return;

    // Dynamically import Phaser (client-side only)
    import('phaser').then((Phaser) => {
      const TILE_SIZE = 16;
      const GRID_COLS = 12;
      const GRID_ROWS = 5;
      
      class WorldScene extends Phaser.Scene {
        private crabSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
        private agentData: AgentPublic[] = [];
        private mapPixelWidth = 0;
        private mapPixelHeight = 0;

        constructor() {
          super({ key: 'WorldScene' });
        }

        preload() {
          // Load RPG Maker 16x16 tilesets (clean tilemaps)
          this.load.image('fg_summer_b', '/sprites/terrain/fg_summer_b.png');
          this.load.image('fg_summer_c', '/sprites/terrain/fg_summer_c.png');
          this.load.image('fg_grounds_a2', '/sprites/terrain/fg_grounds_a2.png');
          this.load.image('fdr_outside_a3', '/sprites/terrain/fdr_outside_a3.png');
          this.load.image('fdr_outside_a4', '/sprites/terrain/fdr_outside_a4.png');

          // Tree sprites
          this.load.spritesheet('trees', '/sprites/terrain/trees.png', {
            frameWidth: 64,
            frameHeight: 80,
          });

          // Full village props sheet (for buildings/props)
          this.load.spritesheet('village_props', '/sprites/terrain/fdr_village_full.png', {
            frameWidth: 16,
            frameHeight: 16,
          });
          
          // Load crab spritesheet
          this.load.spritesheet('crab', '/sprites/crab/crab_idle.png', {
            frameWidth: 32,
            frameHeight: 32,
          });
        }

        create() {
          const mapInfo = this.buildTilemap();
          this.mapPixelWidth = mapInfo.pixelWidth;
          this.mapPixelHeight = mapInfo.pixelHeight;

          // Create crab animation
          this.anims.create({
            key: 'crab-idle',
            frames: this.anims.generateFrameNumbers('crab', { start: 0, end: 3 }),
            frameRate: 4,
            repeat: -1,
          });

          // Add decorative trees
          this.placeTrees();

          // Add zone labels
          this.createZoneLabels();

          // Fit camera to map size
          const zoomX = this.scale.width / this.mapPixelWidth;
          const zoomY = this.scale.height / this.mapPixelHeight;
          const zoom = Math.min(zoomX, zoomY);
          this.cameras.main.setZoom(zoom);
          this.cameras.main.centerOn(this.mapPixelWidth / 2, this.mapPixelHeight / 2);
          this.cameras.main.roundPixels = true;

          setIsLoading(false);
        }

        buildTilemap() {
          const CELL_TILES = 5;
          const MAP_COLS = GRID_COLS * CELL_TILES;
          const MAP_ROWS = GRID_ROWS * CELL_TILES;
          const pixelWidth = MAP_COLS * TILE_SIZE;
          const pixelHeight = MAP_ROWS * TILE_SIZE;

          const map = this.make.tilemap({
            tileWidth: TILE_SIZE,
            tileHeight: TILE_SIZE,
            width: MAP_COLS,
            height: MAP_ROWS,
          });

          const fgTiles = map.addTilesetImage('fg_summer_b', 'fg_summer_b', TILE_SIZE, TILE_SIZE, 0, 0);
          const fgDecorTiles = map.addTilesetImage('fg_summer_c', 'fg_summer_c', TILE_SIZE, TILE_SIZE, 0, 0);
          const groundTiles = map.addTilesetImage('fg_grounds_a2', 'fg_grounds_a2', TILE_SIZE, TILE_SIZE, 0, 0);
          const marketRoofTiles = map.addTilesetImage('fdr_outside_a3', 'fdr_outside_a3', TILE_SIZE, TILE_SIZE, 0, 0);
          const marketGroundTiles = map.addTilesetImage('fdr_outside_a4', 'fdr_outside_a4', TILE_SIZE, TILE_SIZE, 0, 0);

          if (!fgTiles || !fgDecorTiles || !groundTiles || !marketRoofTiles || !marketGroundTiles) {
            return { pixelWidth, pixelHeight };
          }

          const baseLayer = map.createBlankLayer('base', groundTiles, 0, 0);
          const forestLayer = map.createBlankLayer('forest', groundTiles, 0, 0);
          const mountainLayer = map.createBlankLayer('mountains', fgDecorTiles, 0, 0);
          const waterLayer = map.createBlankLayer('water', groundTiles, 0, 0);
          const marketGroundLayer = map.createBlankLayer('marketGround', marketGroundTiles, 0, 0);
          const marketRoofLayer = map.createBlankLayer('marketRoof', marketRoofTiles, 0, 0);

          if (!baseLayer || !forestLayer || !mountainLayer || !waterLayer || !marketGroundLayer || !marketRoofLayer) {
            return { pixelWidth, pixelHeight };
          }

          baseLayer.setDepth(0);
          forestLayer.setDepth(2);
          mountainLayer.setDepth(2);
          marketGroundLayer.setDepth(2);
          waterLayer.setDepth(3);
          marketRoofLayer.setDepth(4);

          const fgIndex = (x: number, y: number) => y * 16 + x;
          const groundIndex = (x: number, y: number) => y * 16 + x;
          const waterIndex = (x: number, y: number) => y * 16 + x;
          const decorIndex = (x: number, y: number) => y * 16 + x;
          const a3Index = (x: number, y: number) => y * 16 + x;
          const a4Index = (x: number, y: number) => y * 16 + x;

          const grassTiles = [
            groundIndex(0, 0), groundIndex(1, 0), groundIndex(2, 0), groundIndex(3, 0),
            groundIndex(0, 1), groundIndex(1, 1), groundIndex(2, 1), groundIndex(3, 1),
          ];
          const forestTiles = [
            groundIndex(8, 0), groundIndex(9, 0), groundIndex(10, 0),
            groundIndex(8, 1), groundIndex(9, 1), groundIndex(10, 1),
          ];
          const mountainBaseTiles = [
            groundIndex(0, 4), groundIndex(1, 4), groundIndex(2, 4),
            groundIndex(0, 5), groundIndex(1, 5), groundIndex(2, 5),
          ];
          const mountainTiles = [
            decorIndex(4, 2), decorIndex(5, 2), decorIndex(6, 2), decorIndex(7, 2),
            decorIndex(4, 3), decorIndex(5, 3), decorIndex(6, 3), decorIndex(7, 3),
          ];
          const waterFillTiles = [
            groundIndex(8, 8), groundIndex(9, 8), groundIndex(10, 8),
            groundIndex(8, 9), groundIndex(9, 9), groundIndex(10, 9),
          ];
          const marketGroundTileIds = [
            groundIndex(0, 4), groundIndex(1, 4), groundIndex(2, 4),
            groundIndex(0, 5), groundIndex(1, 5), groundIndex(2, 5),
          ];
          const marketRoofTileIds = [a3Index(0, 2), a3Index(1, 2), a3Index(2, 2), a3Index(3, 2)];

          const fillZone = (
            layer: Phaser.Tilemaps.TilemapLayer,
            tiles: number[],
            zone: typeof ZONES[number],
            options: { sparse?: boolean; skipChance?: number; padding?: number } = {}
          ) => {
            const padding = options.padding ?? 0;
            const zoneX = zone.x * CELL_TILES + padding;
            const zoneY = zone.y * CELL_TILES + padding;
            const zoneW = zone.w * CELL_TILES - padding * 2;
            const zoneH = zone.h * CELL_TILES - padding * 2;
            if (zoneW <= 0 || zoneH <= 0) return;
            const sparse = options.sparse ?? false;
            const skipChance = options.skipChance ?? 0.35;

            for (let y = 0; y < zoneH; y++) {
              for (let x = 0; x < zoneW; x++) {
                if (sparse && Math.random() < skipChance) continue;
                const tileIndex = Phaser.Utils.Array.GetRandom(tiles);
                layer.putTileAt(tileIndex, zoneX + x, zoneY + y);
              }
            }
          };

          const fillRect = (
            layer: Phaser.Tilemaps.TilemapLayer,
            tiles: number[],
            tileX: number,
            tileY: number,
            tileW: number,
            tileH: number
          ) => {
            for (let y = 0; y < tileH; y++) {
              for (let x = 0; x < tileW; x++) {
                const tileIndex = Phaser.Utils.Array.GetRandom(tiles);
                layer.putTileAt(tileIndex, tileX + x, tileY + y);
              }
            }
          };

          ZONES.forEach((zone) => {
            switch (zone.terrain) {
              case 'grass':
                fillZone(baseLayer, grassTiles, zone);
                break;
              case 'forest':
                fillZone(baseLayer, grassTiles, zone);
                fillZone(forestLayer, forestTiles, zone, { sparse: true, skipChance: 0.25 });
                break;
              case 'mountain':
                fillZone(baseLayer, mountainBaseTiles, zone);
                fillZone(mountainLayer, mountainTiles, zone, { sparse: true, skipChance: 0.1 });
                break;
              case 'water':
                fillZone(baseLayer, grassTiles, zone);
                fillZone(waterLayer, waterFillTiles, zone, { padding: 1 });
                this.addWaterOverlay(zone, CELL_TILES);
                break;
              case 'market':
                // Keep market compact and centered
                const zoneX = zone.x * CELL_TILES;
                const zoneY = zone.y * CELL_TILES;
                const zoneW = zone.w * CELL_TILES;
                const zoneH = zone.h * CELL_TILES;
                const marketW = Math.max(6, Math.floor(zoneW * 0.7));
                const marketH = Math.max(3, Math.floor(zoneH * 0.55));
                const marketX = zoneX + Math.floor((zoneW - marketW) / 2);
                const marketY = zoneY + 1;

                fillZone(baseLayer, grassTiles, zone);
                // Keep the market on grass and just place a small built area
                fillRect(marketGroundLayer, marketGroundTileIds.slice(0, 2), marketX, marketY, marketW, marketH);
                const marketBounds = {
                  x: marketX / CELL_TILES,
                  y: marketY / CELL_TILES,
                  w: marketW / CELL_TILES,
                  h: marketH / CELL_TILES,
                };

                this.placeMarketRoofs(marketRoofLayer, marketRoofTileIds, {
                  ...zone,
                  ...marketBounds,
                }, CELL_TILES);
                this.placeMarketProps(marketBounds, CELL_TILES);
                break;
            }
          });

          return { pixelWidth, pixelHeight };
        }

        placeMarketRoofs(
          roofLayer: Phaser.Tilemaps.TilemapLayer,
          roofTiles: number[],
          zone: typeof ZONES[number],
          cellTiles: number
        ) {
          const zoneX = zone.x * cellTiles;
          const zoneY = zone.y * cellTiles;
          const zoneW = zone.w * cellTiles;
          const zoneH = zone.h * cellTiles;

          const buildingCount = 2;
          for (let i = 0; i < buildingCount; i++) {
            const bw = 3 + Math.floor(Math.random() * 2);
            const bh = 2 + Math.floor(Math.random() * 2);
            const bx = zoneX + 1 + Math.floor(Math.random() * Math.max(1, zoneW - bw - 2));
            const by = zoneY + 1 + Math.floor(Math.random() * Math.max(1, zoneH - bh - 2));

            for (let y = 0; y < bh; y++) {
              for (let x = 0; x < bw; x++) {
                const tileIndex = roofTiles[(x + y) % roofTiles.length];
                roofLayer.putTileAt(tileIndex, bx + x, by + y);
              }
            }
          }
        }

        placeMarketProps(
          marketBounds: { x: number; y: number; w: number; h: number },
          cellTiles: number
        ) {
          const zoneX = marketBounds.x * cellTiles * 16;
          const zoneY = marketBounds.y * cellTiles * 16;
          const zoneW = marketBounds.w * cellTiles * 16;
          const zoneH = marketBounds.h * cellTiles * 16;

          // Sample props from the full village sheet (crates, signs, wells)
          const propFrames = [18, 19, 20, 21, 34, 35, 36, 37];
          for (let i = 0; i < 4; i++) {
            const px = zoneX + 16 + Math.random() * (zoneW - 32);
            const py = zoneY + 16 + Math.random() * (zoneH - 32);
            const frame = Phaser.Utils.Array.GetRandom(propFrames);
            const prop = this.add.sprite(px, py, 'village_props', frame);
            prop.setScale(2);
            prop.setDepth(6);
          }
        }

        placeTrees() {
          ZONES.filter(z => z.terrain === 'forest').forEach(zone => {
            const zoneX = zone.x * 5 * 16;
            const zoneY = zone.y * 5 * 16;
            const zoneW = zone.w * 5 * 16;
            const zoneH = zone.h * 5 * 16;

            for (let i = 0; i < 24; i++) {
              const tx = zoneX + 16 + Math.random() * (zoneW - 32);
              const ty = zoneY + 16 + Math.random() * (zoneH - 32);
              const frame = Math.floor(Math.random() * 4);
              const tree = this.add.sprite(tx, ty, 'trees', frame);
              tree.setOrigin(0.5, 1);
              tree.setScale(0.6 + Math.random() * 0.3);
              tree.setDepth(6);
            }
          });
        }

        addWaterOverlay(zone: typeof ZONES[number], cellTiles: number) {
          const zoneX = zone.x * cellTiles * 16;
          const zoneY = zone.y * cellTiles * 16;
          const zoneW = zone.w * cellTiles * 16;
          const zoneH = zone.h * cellTiles * 16;

          const overlay = this.add.rectangle(
            zoneX + 16,
            zoneY + 16,
            Math.max(0, zoneW - 32),
            Math.max(0, zoneH - 32),
            0x3a8bdc,
            0.75
          );
          overlay.setOrigin(0, 0);
          overlay.setDepth(5);

          const highlight = this.add.rectangle(
            zoneX + 24,
            zoneY + 24,
            Math.max(0, zoneW - 48),
            Math.max(0, zoneH - 48),
            0x6ec7ff,
            0.18
          );
          highlight.setOrigin(0, 0);
          highlight.setDepth(6);
        }

        createZoneLabels() {
          ZONES.filter(z => z.name).forEach(zone => {
            const zonePixelW = zone.w * 5 * 16;
            const zonePixelH = zone.h * 5 * 16;
            const zoneX = zone.x * 5 * 16 + zonePixelW / 2;
            const zoneY = zone.y * 5 * 16 + 18;

            const bg = this.add.rectangle(zoneX, zoneY, 70, 24, 0xffffff, 0.92);
            bg.setStrokeStyle(2, 0x2d2a26);
            bg.setDepth(10);

            const text = this.add.text(zoneX, zoneY, zone.name, {
              fontSize: '10px',
              fontFamily: 'monospace',
              color: '#2d2a26',
              fontStyle: 'bold',
            });
            text.setOrigin(0.5);
            text.setDepth(11);
          });
        }

        updateAgents(newAgents: AgentPublic[]) {
          this.agentData = newAgents;
          
          // Remove old sprites
          this.crabSprites.forEach((sprite) => sprite.destroy());
          this.crabSprites.clear();
          
          // Add new crab sprites
          newAgents.forEach((agent) => {
            // Map agent world position (0-500) to screen position
            const screenX = (agent.x / 500) * this.mapPixelWidth;
            const screenY = (agent.y / 500) * this.mapPixelHeight;
            
            const crab = this.add.sprite(screenX, screenY, 'crab');
            crab.play('crab-idle');
            crab.setScale(1.2);
            crab.setDepth(5);
            
            // Random flip for variety
            if (Math.random() > 0.5) {
              crab.setFlipX(true);
            }
            
            this.crabSprites.set(agent.id, crab);
          });
        }
      }

      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: gameRef.current!,
        width,
        height,
        backgroundColor: '#faf7f2',
        pixelArt: true,
        scene: WorldScene,
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
      };

      phaserGameRef.current = new Phaser.Game(config);

      // Store scene reference for updates
      phaserGameRef.current.events.once('ready', () => {
        const scene = phaserGameRef.current!.scene.getScene('WorldScene') as WorldScene;
        if (scene && agents.length > 0) {
          scene.updateAgents(agents);
        }
      });
    });

    return () => {
      if (phaserGameRef.current) {
        phaserGameRef.current.destroy(true);
        phaserGameRef.current = null;
      }
    };
  }, [width, height]);

  // Update agents when they change
  useEffect(() => {
    if (phaserGameRef.current) {
      const scene = phaserGameRef.current.scene.getScene('WorldScene') as any;
      if (scene && scene.updateAgents) {
        scene.updateAgents(agents);
      }
    }
  }, [agents]);

  return (
    <div className="relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--surface-alt)] z-10">
          <div className="text-center">
            <div className="text-4xl mb-2 animate-bounce">🗺️</div>
            <div className="text-[var(--muted)]">Loading world...</div>
          </div>
        </div>
      )}
      <div 
        ref={gameRef} 
        className="rounded-xl overflow-hidden border-4 border-[var(--foreground)] shadow-[8px_8px_0_rgba(45,42,38,0.2)]"
        style={{ width, height }}
      />
    </div>
  );
}
