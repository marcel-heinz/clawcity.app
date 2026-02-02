'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { AgentPublic, Tile, TerrainType } from '@/lib/types';
import { supabase } from '@/lib/supabase';

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
};

const BLOCK_SIZE = 1;

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

  const VIEW_RADIUS = 12;

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

  // Create mountain (3 stacked blocks)
  const createMountain = useCallback(() => {
    const group = new THREE.Group();
    const size = BLOCK_SIZE * 0.9;

    // Bottom block (dark grey)
    const bottomGeo = new THREE.BoxGeometry(size, size, size);
    const bottomMat = new THREE.MeshBasicMaterial({ color: COLORS.mountainDark });
    const bottom = new THREE.Mesh(bottomGeo, bottomMat);
    bottom.position.y = size / 2;
    group.add(bottom);

    // Middle block (mid grey)
    const midGeo = new THREE.BoxGeometry(size * 0.8, size, size * 0.8);
    const midMat = new THREE.MeshBasicMaterial({ color: COLORS.mountainMid });
    const mid = new THREE.Mesh(midGeo, midMat);
    mid.position.y = size * 1.5;
    group.add(mid);

    // Top block (light grey)
    const topGeo = new THREE.BoxGeometry(size * 0.6, size, size * 0.6);
    const topMat = new THREE.MeshBasicMaterial({ color: COLORS.mountainLight });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = size * 2.5;
    group.add(top);

    return group;
  }, []);

  // Create forest (2 stacked blocks)
  const createTree = useCallback(() => {
    const group = new THREE.Group();
    const size = BLOCK_SIZE * 0.7;

    // Trunk (brown)
    const trunkGeo = new THREE.BoxGeometry(size * 0.4, size, size * 0.4);
    const trunkMat = new THREE.MeshBasicMaterial({ color: COLORS.treeTrunk });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = size / 2;
    group.add(trunk);

    // Leaves (dark green)
    const leavesGeo = new THREE.BoxGeometry(size, size, size);
    const leavesMat = new THREE.MeshBasicMaterial({ color: COLORS.treeLeaves });
    const leaves = new THREE.Mesh(leavesGeo, leavesMat);
    leaves.position.y = size * 1.5;
    group.add(leaves);

    return group;
  }, []);

  // Create market (yellow base + red roof)
  const createMarket = useCallback(() => {
    const group = new THREE.Group();
    const size = BLOCK_SIZE * 0.9;

    // Yellow base
    const baseGeo = new THREE.BoxGeometry(size, size, size);
    const baseMat = new THREE.MeshBasicMaterial({ color: COLORS.marketBase });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = size / 2;
    group.add(base);

    // Red roof
    const roofGeo = new THREE.BoxGeometry(size * 1.1, size * 0.4, size * 1.1);
    const roofMat = new THREE.MeshBasicMaterial({ color: COLORS.marketRoof });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = size * 1.2;
    group.add(roof);

    return group;
  }, []);

  // Create water block (flat blue)
  const createWater = useCallback(() => {
    const size = BLOCK_SIZE;
    const waterGeo = new THREE.BoxGeometry(size, 0.1, size);
    const waterMat = new THREE.MeshBasicMaterial({ color: COLORS.water });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = 0.05;
    return water;
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

  // Build terrain from tiles
  const buildTerrain = useCallback((tiles: Tile[], cx: number, cy: number) => {
    const terrainGroup = terrainGroupRef.current;
    if (!terrainGroup) return;

    // Clear existing terrain
    while (terrainGroup.children.length > 0) {
      const child = terrainGroup.children[0];
      terrainGroup.remove(child);
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
        // Plains: no object, just ground
      }

      if (obj) {
        obj.position.set(x + offsetX, 0, z + offsetZ);
        terrainGroup.add(obj);
      }
    });
  }, [createMountain, createTree, createMarket, createWater]);

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

    // Create player crab (positioned in front of camera, visible)
    const playerCrab = createCrabMesh(COLORS.agentSelf);
    playerCrab.position.set(0, 0, 0.5); // Slightly in front of camera center
    playerCrab.scale.setScalar(1.2);
    playerCrab.rotation.y = Math.PI; // Face forward (away from camera)
    scene.add(playerCrab);

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
  }, [centerX, centerY, createCrabMesh, fetchTiles, buildTerrain]);

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
          <div className="pointer-events-auto bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2">
            <div className="text-white font-bold">{agentName || 'Agent'}</div>
            <div className="text-white/70 text-sm">({displayPos.x}, {displayPos.y})</div>
            <div className="text-green-400 text-xs mt-1 flex items-center gap-1">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Live
            </div>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="pointer-events-auto px-4 py-2 bg-black/60 backdrop-blur-sm hover:bg-black/80 rounded-lg text-white font-medium transition-colors"
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

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-white">
        <div className="flex gap-4">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: '#ff4444' }} /> You
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: '#ff8844' }} /> Others
          </span>
        </div>
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-3 right-3 z-10 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-white/70">
        Agent&apos;s eye view
      </div>
    </div>
  );
}
