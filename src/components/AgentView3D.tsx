'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { AgentPublic, Tile, TerrainType, WORLD_SIZE } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { CrabSprite } from '@/components/CrabSprite';

// Minecraft-style colors
const COLORS = {
  sky: 0x87CEEB,
  ground: 0x5a8f29,
  // Mountain: 3 layers
  mountainDark: 0x4a4a4a,
  mountainMid: 0x6a6a6a,
  mountainLight: 0x9a9a9a,
  // Forest: 2 layers
  treeTrunk: 0x8B4513,
  treeLeaves: 0x1a5a1a,
  // Water
  water: 0x4169E1,
  // Market
  marketBase: 0xFFD700,
  marketRoof: 0xCC0000,
  // Agents
  agentSelf: 0xff4444,
  agentOther: 0xff8844,
  // NEW TERRAIN TYPES
  // Rocky/barren ground
  rockyDark: 0x374151,
  rockyMid: 0x4b5563,
  rockyLight: 0x6b7280,
  // Sand/beach
  sand: 0xe9c46a,
  sandDark: 0xddb84d,
  // Deep water
  deepWater: 0x1e3a5f,
  deepWaterLight: 0x2d5f9a,
  // Marsh
  marshWater: 0x457b9d,
  marshPlant: 0x2d6a4f,
};

const BLOCK_SIZE = 1;

// Terrain colors for minimap (matching terrain-demo.html)
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

interface AgentView3DProps {
  centerX: number;
  centerY: number;
  agents: AgentPublic[];
  selectedAgentId?: string;
  onClose?: () => void;
}

export function AgentView3D({ centerX, centerY, agents, selectedAgentId, onClose }: AgentView3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const agentGroupRef = useRef<THREE.Group | null>(null);
  const terrainGroupRef = useRef<THREE.Group | null>(null);

  // Position tracking for smooth interpolation
  const currentPosRef = useRef({ x: centerX, y: centerY });
  const targetPosRef = useRef({ x: centerX, y: centerY });
  const otherAgentsRef = useRef<Map<string, { current: THREE.Vector3; target: THREE.Vector3; mesh: THREE.Group }>>(new Map());

  const [loading, setLoading] = useState(true);
  const [agentName, setAgentName] = useState('');
  const [displayPos, setDisplayPos] = useState({ x: centerX, y: centerY });
  const [currentTerrain, setCurrentTerrain] = useState<TerrainType>('plains');
  const [worldTiles, setWorldTiles] = useState<Tile[]>([]);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);

  const VIEW_RADIUS = 12;
  const MINIMAP_SIZE = 120;

  // Find selected agent's name
  useEffect(() => {
    const agent = agents.find(a => a.id === selectedAgentId);
    if (agent) {
      setAgentName(agent.name);
    }
  }, [agents, selectedAgentId]);

  // Create a simple crab mesh
  const createCrabMesh = useCallback((color: number) => {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color });

    // Body - flat wide box
    const bodyGeo = new THREE.BoxGeometry(0.5, 0.25, 0.4);
    const body = new THREE.Mesh(bodyGeo, material);
    body.position.y = 0.2;
    group.add(body);

    // Eyes
    const eyeGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.12, 0.35, 0.15);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.12, 0.35, 0.15);
    group.add(leftEye, rightEye);

    // Claws
    const clawGeo = new THREE.BoxGeometry(0.2, 0.15, 0.15);
    const leftClaw = new THREE.Mesh(clawGeo, material);
    leftClaw.position.set(-0.4, 0.15, 0.1);
    const rightClaw = new THREE.Mesh(clawGeo, material);
    rightClaw.position.set(0.4, 0.15, 0.1);
    group.add(leftClaw, rightClaw);

    return group;
  }, []);

  // Create mountain (cone with snow cap)
  const createMountain = useCallback(() => {
    const group = new THREE.Group();
    const height = 2.5 + Math.random() * 0.5;
    const baseRadius = 0.8;
    
    // Main mountain body (cone)
    const mountainGeo = new THREE.ConeGeometry(baseRadius, height * 0.85, 6);
    const mountainMat = new THREE.MeshBasicMaterial({ color: COLORS.mountainMid });
    const mountain = new THREE.Mesh(mountainGeo, mountainMat);
    mountain.position.y = height * 0.425;
    group.add(mountain);
    
    // Snow cap (smaller cone on top)
    const snowGeo = new THREE.ConeGeometry(baseRadius * 0.35, height * 0.25, 6);
    const snowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const snow = new THREE.Mesh(snowGeo, snowMat);
    snow.position.y = height * 0.75;
    group.add(snow);
    
    // Rocky base
    const baseGeo = new THREE.CylinderGeometry(baseRadius * 1.1, baseRadius * 1.2, 0.3, 8);
    const baseMat = new THREE.MeshBasicMaterial({ color: COLORS.mountainDark });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.15;
    group.add(base);

    return group;
  }, []);

  // Create forest (pine tree with layered cone foliage)
  const createTree = useCallback(() => {
    const group = new THREE.Group();
    const treeHeight = 1.2 + Math.random() * 0.4;
    const trunkHeight = treeHeight * 0.35;
    
    // Trunk (cylinder)
    const trunkGeo = new THREE.CylinderGeometry(0.06, 0.1, trunkHeight, 8);
    const trunkMat = new THREE.MeshBasicMaterial({ color: COLORS.treeTrunk });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkHeight / 2;
    group.add(trunk);
    
    // Foliage layers (cones stacked like a pine tree)
    const foliageColor = new THREE.MeshBasicMaterial({ color: COLORS.treeLeaves });
    const layers = 3;
    for (let i = 0; i < layers; i++) {
      const layerRadius = 0.5 - (i * 0.12);
      const layerHeight = 0.5 - (i * 0.1);
      const foliageGeo = new THREE.ConeGeometry(layerRadius, layerHeight, 8);
      const foliage = new THREE.Mesh(foliageGeo, foliageColor);
      foliage.position.y = trunkHeight + (i * 0.25) + 0.2;
      group.add(foliage);
    }

    return group;
  }, []);

  // Create market (building with peaked roof, door, windows)
  const createMarket = useCallback(() => {
    const group = new THREE.Group();
    const wallColor = 0xf5deb3; // Wheat/tan color
    const roofColor = COLORS.marketRoof;
    const doorColor = 0x8B4513;
    const windowColor = 0x87CEEB;
    
    // Main building walls
    const wallGeo = new THREE.BoxGeometry(0.9, 0.8, 0.7);
    const wallMat = new THREE.MeshBasicMaterial({ color: wallColor });
    const walls = new THREE.Mesh(wallGeo, wallMat);
    walls.position.y = 0.4;
    group.add(walls);
    
    // Peaked roof (using a cone rotated)
    const roofHeight = 0.4;
    const roofGeo = new THREE.ConeGeometry(0.7, roofHeight, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roofMat = new THREE.MeshBasicMaterial({ color: roofColor });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 0.8 + roofHeight / 2;
    roof.scale.set(1, 1, 0.8);
    group.add(roof);
    
    // Door
    const doorGeo = new THREE.BoxGeometry(0.2, 0.4, 0.05);
    const doorMat = new THREE.MeshBasicMaterial({ color: doorColor });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 0.2, 0.36);
    group.add(door);
    
    // Windows (2 on front)
    const winGeo = new THREE.BoxGeometry(0.15, 0.15, 0.05);
    const winMat = new THREE.MeshBasicMaterial({ color: windowColor });
    const win1 = new THREE.Mesh(winGeo, winMat);
    win1.position.set(-0.25, 0.5, 0.36);
    const win2 = new THREE.Mesh(winGeo, winMat);
    win2.position.set(0.25, 0.5, 0.36);
    group.add(win1, win2);
    
    // Market awning/sign
    const awningGeo = new THREE.BoxGeometry(1.0, 0.05, 0.3);
    const awningMat = new THREE.MeshBasicMaterial({ color: COLORS.marketBase });
    const awning = new THREE.Mesh(awningGeo, awningMat);
    awning.position.set(0, 0.7, 0.5);
    awning.rotation.x = -0.2;
    group.add(awning);

    return group;
  }, []);

  // Create water (flat plane)
  const createWater = useCallback(() => {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE),
      new THREE.MeshBasicMaterial({ color: COLORS.water, transparent: true, opacity: 0.85 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.02;
    return water;
  }, []);

  // Create rocky ground (organic scattered rocks)
  const createRocky = useCallback(() => {
    const group = new THREE.Group();
    const rockColors = [COLORS.rockyDark, COLORS.rockyMid, COLORS.rockyLight];
    const numRocks = 4 + Math.floor(Math.random() * 3);
    
    for (let i = 0; i < numRocks; i++) {
      const size = 0.1 + Math.random() * 0.2;
      const rockGeo = new THREE.DodecahedronGeometry(size, 0);
      const rockMat = new THREE.MeshBasicMaterial({ color: rockColors[Math.floor(Math.random() * 3)] });
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(
        (Math.random() - 0.5) * 0.6,
        size * 0.7,
        (Math.random() - 0.5) * 0.6
      );
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      group.add(rock);
    }

    return group;
  }, []);

  // Create sand (flat with gentle dune mounds)
  const createSand = useCallback(() => {
    const group = new THREE.Group();
    
    // Base sand plane
    const sandBase = new THREE.Mesh(
      new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE),
      new THREE.MeshBasicMaterial({ color: COLORS.sand })
    );
    sandBase.rotation.x = -Math.PI / 2;
    sandBase.position.y = 0.01;
    group.add(sandBase);
    
    // Small dune mound (half sphere)
    const duneGeo = new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    const duneMat = new THREE.MeshBasicMaterial({ color: COLORS.sandDark });
    const dune = new THREE.Mesh(duneGeo, duneMat);
    dune.position.set(0.2, 0, 0.1);
    dune.scale.set(1.5, 0.5, 1);
    group.add(dune);

    return group;
  }, []);

  // Create deep water (darker, deeper plane)
  const createDeepWater = useCallback(() => {
    const dw = new THREE.Mesh(
      new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE),
      new THREE.MeshBasicMaterial({ color: COLORS.deepWater, transparent: true, opacity: 0.9 })
    );
    dw.rotation.x = -Math.PI / 2;
    dw.position.y = -0.05;
    return dw;
  }, []);

  // Create marsh (shallow water with cattails/reeds)
  const createMarsh = useCallback(() => {
    const group = new THREE.Group();
    
    // Shallow murky water plane
    const mw = new THREE.Mesh(
      new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE),
      new THREE.MeshBasicMaterial({ color: COLORS.marshWater, transparent: true, opacity: 0.75 })
    );
    mw.rotation.x = -Math.PI / 2;
    mw.position.y = 0.02;
    group.add(mw);
    
    // Cattails/reeds (cylinder stalks with oval tops)
    const numReeds = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numReeds; i++) {
      const reedGroup = new THREE.Group();
      
      // Stalk (thin cylinder)
      const stalkGeo = new THREE.CylinderGeometry(0.015, 0.02, 0.5, 6);
      const stalkMat = new THREE.MeshBasicMaterial({ color: 0x556b2f });
      const stalk = new THREE.Mesh(stalkGeo, stalkMat);
      stalk.position.y = 0.25;
      reedGroup.add(stalk);
      
      // Cattail top (brown cylinder)
      const topGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8);
      const topMat = new THREE.MeshBasicMaterial({ color: 0x654321 });
      const top = new THREE.Mesh(topGeo, topMat);
      top.position.y = 0.45;
      reedGroup.add(top);
      
      reedGroup.position.set(
        (Math.random() - 0.5) * 0.6,
        0,
        (Math.random() - 0.5) * 0.6
      );
      reedGroup.rotation.z = (Math.random() - 0.5) * 0.2;
      group.add(reedGroup);
    }

    return group;
  }, []);

  // Fetch tiles
  const fetchTiles = useCallback(async (cx: number, cy: number) => {
    try {
      const response = await fetch(`/api/world/tiles?x=${cx}&y=${cy}&radius=${VIEW_RADIUS}`);
      const data = await response.json();
      if (data.success) {
        return data.data.tiles as Tile[];
      }
    } catch (error) {
      console.error('Failed to fetch tiles:', error);
    }
    return [];
  }, []);

  // Fetch all tiles for minimap (larger radius)
  const fetchWorldTiles = useCallback(async () => {
    try {
      // Fetch entire world with sampling for performance
      const response = await fetch(`/api/world/tiles?x=${WORLD_SIZE / 2}&y=${WORLD_SIZE / 2}&radius=${WORLD_SIZE / 2}&sample=5`);
      const data = await response.json();
      if (data.success) {
        setWorldTiles(data.data.tiles as Tile[]);
      }
    } catch (error) {
      console.error('Failed to fetch world tiles:', error);
    }
  }, []);

  // Fetch world tiles for minimap on mount
  useEffect(() => {
    fetchWorldTiles();
  }, [fetchWorldTiles]);

  // Build terrain from tiles
  const buildTerrain = useCallback((tiles: Tile[], cx: number, cy: number) => {
    const terrainGroup = terrainGroupRef.current;
    if (!terrainGroup) return;

    // Clear existing terrain
    while (terrainGroup.children.length > 0) {
      const child = terrainGroup.children[0];
      terrainGroup.remove(child);
    }

    // Find current tile to update terrain display
    const currentTile = tiles.find(t => t.x === Math.floor(cx) && t.y === Math.floor(cy));
    if (currentTile) {
      setCurrentTerrain(currentTile.terrain);
    }

    tiles.forEach((tile) => {
      const x = tile.x - cx;
      const z = tile.y - cy;

      // Add some variety based on position
      const seed = (tile.x * 7 + tile.y * 13) % 100;
      const offsetX = (seed % 10 - 5) * 0.02;
      const offsetZ = ((seed * 3) % 10 - 5) * 0.02;

      let obj: THREE.Object3D | null = null;

      switch (tile.terrain) {
        case 'mountain':
          obj = createMountain();
          break;
        case 'forest':
          obj = createTree();
          break;
        case 'market':
          obj = createMarket();
          break;
        case 'water':
          obj = createWater();
          break;
        // NEW TERRAIN TYPES
        case 'rocky':
          obj = createRocky();
          break;
        case 'sand':
          obj = createSand();
          break;
        case 'deep_water':
          obj = createDeepWater();
          break;
        case 'marsh':
          obj = createMarsh();
          break;
        // Plains: no object, just ground
      }

      if (obj) {
        obj.position.set(x + offsetX, 0, z + offsetZ);
        terrainGroup.add(obj);
      }
    });
  }, [createMountain, createTree, createMarket, createWater, createRocky, createSand, createDeepWater, createMarsh]);

  // Update minimap canvas
  const updateMinimap = useCallback(() => {
    const canvas = minimapCanvasRef.current;
    if (!canvas || worldTiles.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = MINIMAP_SIZE / WORLD_SIZE;

    // Clear canvas
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    // Draw terrain tiles
    worldTiles.forEach(tile => {
      ctx.fillStyle = TERRAIN_COLORS[tile.terrain] || '#555';
      ctx.fillRect(tile.x * scale, tile.y * scale, Math.ceil(scale), Math.ceil(scale));
    });

    // Draw agent position marker (red dot)
    ctx.fillStyle = '#ff4444';
    ctx.beginPath();
    ctx.arc(displayPos.x * scale, displayPos.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [worldTiles, displayPos]);

  // Update minimap when position or tiles change
  useEffect(() => {
    updateMinimap();
  }, [updateMinimap]);

  // Main scene setup
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.sky);
    scene.fog = new THREE.Fog(COLORS.sky, 8, 25);
    sceneRef.current = scene;

    // Camera - ground level, behind agent, looking at horizon
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    camera.position.set(0, 0.8, 3); // At crab eye level, close behind
    camera.lookAt(0, 0.8, -20); // Look at horizon (same Y = level view)
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    const groundMat = new THREE.MeshBasicMaterial({ color: COLORS.ground });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    scene.add(ground);

    // Terrain group
    const terrainGroup = new THREE.Group();
    terrainGroupRef.current = terrainGroup;
    scene.add(terrainGroup);

    // Agent group
    const agentGroup = new THREE.Group();
    agentGroupRef.current = agentGroup;
    scene.add(agentGroup);

    // Initial load
    fetchTiles(centerX, centerY).then(tiles => {
      buildTerrain(tiles, centerX, centerY);
      setLoading(false);
    });

    // Animation loop with interpolation
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);

      // Smooth interpolation of position (lerp) - 0.3 for ultra-snappy realtime feel
      const lerpFactor = 0.3;
      currentPosRef.current.x += (targetPosRef.current.x - currentPosRef.current.x) * lerpFactor;
      currentPosRef.current.y += (targetPosRef.current.y - currentPosRef.current.y) * lerpFactor;

      // Interpolate other agents
      otherAgentsRef.current.forEach((agentData) => {
        agentData.current.lerp(agentData.target, lerpFactor);
        agentData.mesh.position.copy(agentData.current);
      });

      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [centerX, centerY, fetchTiles, buildTerrain, fetchWorldTiles]);

  // Supabase Realtime subscription for instant position updates
  useEffect(() => {
    let isMounted = true;

    // Handler for agent position updates
    const handleAgentUpdate = async (payload: { new: { id: string; x: number; y: number; name: string } }) => {
      if (!isMounted) return;
      
      const updatedAgent = payload.new;
      
      // Check if this is our selected agent
      if (updatedAgent.id === selectedAgentId) {
        const oldX = targetPosRef.current.x;
        const oldY = targetPosRef.current.y;

        // Update target position instantly
        targetPosRef.current.x = updatedAgent.x;
        targetPosRef.current.y = updatedAgent.y;
        setDisplayPos({ x: updatedAgent.x, y: updatedAgent.y });

        // If position changed, refetch terrain
        if (Math.abs(updatedAgent.x - oldX) > 0 || Math.abs(updatedAgent.y - oldY) > 0) {
          const tiles = await fetchTiles(updatedAgent.x, updatedAgent.y);
          buildTerrain(tiles, updatedAgent.x, updatedAgent.y);
        }
      } else {
        // Update other agent position
        const agentGroup = agentGroupRef.current;
        if (!agentGroup) return;

        const cx = targetPosRef.current.x;
        const cy = targetPosRef.current.y;
        const relX = updatedAgent.x - cx;
        const relZ = updatedAgent.y - cy;

        // Only show nearby agents
        if (Math.abs(relX) > VIEW_RADIUS || Math.abs(relZ) > VIEW_RADIUS) {
          // Remove if now out of range
          const existing = otherAgentsRef.current.get(updatedAgent.id);
          if (existing) {
            agentGroup.remove(existing.mesh);
            otherAgentsRef.current.delete(updatedAgent.id);
          }
          return;
        }

        const existing = otherAgentsRef.current.get(updatedAgent.id);
        if (existing) {
          // Update target position for smooth lerp
          existing.target.set(relX, 0, relZ);
        } else {
          // Create new agent mesh
          const mesh = createCrabMesh(COLORS.agentOther);
          mesh.position.set(relX, 0, relZ);
          agentGroup.add(mesh);
          otherAgentsRef.current.set(updatedAgent.id, {
            current: new THREE.Vector3(relX, 0, relZ),
            target: new THREE.Vector3(relX, 0, relZ),
            mesh
          });
        }
      }
    };

    // Initial fetch to populate state
    const initialFetch = async () => {
      try {
        const response = await fetch('/api/world/status');
        const data = await response.json();

        if (data.success && data.data.agents) {
          const allAgents: AgentPublic[] = data.data.agents;

          // Find our agent
          const ourAgent = allAgents.find(a => a.id === selectedAgentId);
          if (ourAgent) {
            targetPosRef.current.x = ourAgent.x;
            targetPosRef.current.y = ourAgent.y;
            setDisplayPos({ x: ourAgent.x, y: ourAgent.y });
            
            const tiles = await fetchTiles(ourAgent.x, ourAgent.y);
            buildTerrain(tiles, ourAgent.x, ourAgent.y);
          }

          // Populate other agents
          const agentGroup = agentGroupRef.current;
          if (agentGroup) {
            const cx = targetPosRef.current.x;
            const cy = targetPosRef.current.y;

            allAgents.forEach(agent => {
              if (agent.id === selectedAgentId) return;

              const relX = agent.x - cx;
              const relZ = agent.y - cy;

              if (Math.abs(relX) <= VIEW_RADIUS && Math.abs(relZ) <= VIEW_RADIUS) {
                const mesh = createCrabMesh(COLORS.agentOther);
                mesh.position.set(relX, 0, relZ);
                agentGroup.add(mesh);
                otherAgentsRef.current.set(agent.id, {
                  current: new THREE.Vector3(relX, 0, relZ),
                  target: new THREE.Vector3(relX, 0, relZ),
                  mesh
                });
              }
            });
          }
        }
      } catch (error) {
        console.error('Initial fetch error:', error);
      }
    };

    // Do initial fetch
    initialFetch();

    // Subscribe to realtime updates on agents_realtime table
    const channel = supabase
      .channel('agent-fpv-' + selectedAgentId)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agents_realtime',
        },
        (payload) => {
          handleAgentUpdate(payload as unknown as { new: { id: string; x: number; y: number; name: string } });
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [selectedAgentId, fetchTiles, buildTerrain, createCrabMesh]);

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden">
      {/* HUD */}
      <div className="absolute top-0 left-0 right-0 z-10 p-3 pointer-events-none">
        <div className="flex justify-between items-start">
          <div className="pointer-events-auto bg-black/70 backdrop-blur-sm rounded-lg px-4 py-3">
            <div className="text-white font-bold text-sm">{agentName || 'Agent'}</div>
            <div className="text-white/70 text-xs mt-0.5">({displayPos.x}, {displayPos.y})</div>
            <div className="text-green-400 text-xs mt-1 flex items-center gap-1">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Live
            </div>
            <div className="text-white/70 text-xs mt-1">Terrain: {currentTerrain.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}</div>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="pointer-events-auto px-4 py-2 bg-black/70 backdrop-blur-sm hover:bg-black/80 rounded-lg text-white font-medium transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
          <div className="text-white text-center">
            <div className="text-3xl mb-2">🦀</div>
            <span>Entering world...</span>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Bottom left - Agent's eye view label */}
      <div className="absolute bottom-3 left-3 z-10 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-white/70">
        Agent&apos;s eye view
      </div>

      {/* Bottom right - Minimap */}
      <div className="absolute bottom-3 right-3 z-10 bg-black/80 backdrop-blur-sm rounded-lg overflow-hidden border-2 border-white/20" style={{ width: MINIMAP_SIZE, height: MINIMAP_SIZE }}>
        <canvas
          ref={minimapCanvasRef}
          width={MINIMAP_SIZE}
          height={MINIMAP_SIZE}
          className="w-full h-full"
        />
      </div>

      {/* Bottom center - Small crab indicator */}
      <div className="absolute bottom-3 left-1/2 transform -translate-x-1/2 z-10 pointer-events-none">
        <CrabSprite animation="idle" scale={0.4} />
      </div>
    </div>
  );
}
