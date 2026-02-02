'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { AgentPublic, Tile, TerrainType } from '@/lib/types';

// Colors
const COLORS = {
  sky: 0x87ceeb,
  fog: 0xa8d5e5,
  ground: 0x7cb342,
  water: 0x42a5f5,
  forest: 0x2d6b1e,
  mountain: 0x6b7b8c,
  mountainSnow: 0xffffff,
  market: 0xd4a574,
  agentSelf: 0xff4444,
  agentOther: 0xff8844,
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
  const agentMeshesRef = useRef<Map<string, THREE.Group>>(new Map());
  const terrainGroupRef = useRef<THREE.Group | null>(null);
  const tilesRef = useRef<Tile[]>([]);

  const [loading, setLoading] = useState(true);
  const [agentPos, setAgentPos] = useState({ x: centerX, y: centerY });
  const [agentName, setAgentName] = useState('');

  const VIEW_RADIUS = 15;
  const POLL_INTERVAL = 2000; // Poll every 2 seconds

  // Find selected agent's name
  useEffect(() => {
    const agent = agents.find(a => a.id === selectedAgentId);
    if (agent) {
      setAgentName(agent.name);
    }
  }, [agents, selectedAgentId]);

  // Real-time position polling
  useEffect(() => {
    const pollPosition = async () => {
      try {
        const response = await fetch(`/api/world/status`);
        const data = await response.json();
        if (data.success && data.data.agents) {
          const agent = data.data.agents.find((a: AgentPublic) => a.id === selectedAgentId);
          if (agent && (agent.x !== agentPos.x || agent.y !== agentPos.y)) {
            setAgentPos({ x: agent.x, y: agent.y });
          }
        }
      } catch (error) {
        console.error('Failed to poll position:', error);
      }
    };

    const interval = setInterval(pollPosition, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [selectedAgentId, agentPos.x, agentPos.y]);

  // Build a simple crab shape from primitives
  const createCrabMesh = useCallback((isSelected: boolean) => {
    const group = new THREE.Group();
    const color = isSelected ? COLORS.agentSelf : COLORS.agentOther;
    const material = new THREE.MeshBasicMaterial({ color });

    // Body - flattened sphere
    const bodyGeo = new THREE.SphereGeometry(0.4, 8, 6);
    const body = new THREE.Mesh(bodyGeo, material);
    body.scale.set(1, 0.5, 0.8);
    body.position.y = 0.25;
    group.add(body);

    // Eyes - two small spheres
    const eyeGeo = new THREE.SphereGeometry(0.08, 6, 4);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.15, 0.4, 0.3);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.15, 0.4, 0.3);
    group.add(leftEye, rightEye);

    // Claws - two cones
    const clawGeo = new THREE.ConeGeometry(0.15, 0.4, 6);
    const leftClaw = new THREE.Mesh(clawGeo, material);
    leftClaw.position.set(-0.5, 0.2, 0.2);
    leftClaw.rotation.z = Math.PI / 3;
    const rightClaw = new THREE.Mesh(clawGeo, material);
    rightClaw.position.set(0.5, 0.2, 0.2);
    rightClaw.rotation.z = -Math.PI / 3;
    group.add(leftClaw, rightClaw);

    return group;
  }, []);

  // Create tree (cone + cylinder trunk)
  const createTree = useCallback(() => {
    const group = new THREE.Group();

    // Trunk
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 0.5, 6);
    const trunkMat = new THREE.MeshBasicMaterial({ color: 0x8B4513 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.25;
    group.add(trunk);

    // Foliage - cone
    const foliageGeo = new THREE.ConeGeometry(0.4, 1.2, 8);
    const foliageMat = new THREE.MeshBasicMaterial({ color: COLORS.forest });
    const foliage = new THREE.Mesh(foliageGeo, foliageMat);
    foliage.position.y = 1.1;
    group.add(foliage);

    return group;
  }, []);

  // Create mountain (larger cone)
  const createMountain = useCallback((height: number) => {
    const group = new THREE.Group();

    // Mountain body
    const mountainGeo = new THREE.ConeGeometry(height * 0.8, height * 2, 8);
    const mountainMat = new THREE.MeshBasicMaterial({ color: COLORS.mountain });
    const mountain = new THREE.Mesh(mountainGeo, mountainMat);
    mountain.position.y = height;
    group.add(mountain);

    // Snow cap
    if (height > 1) {
      const snowGeo = new THREE.ConeGeometry(height * 0.3, height * 0.5, 8);
      const snowMat = new THREE.MeshBasicMaterial({ color: COLORS.mountainSnow });
      const snow = new THREE.Mesh(snowGeo, snowMat);
      snow.position.y = height * 1.75;
      group.add(snow);
    }

    return group;
  }, []);

  // Create market stall
  const createMarket = useCallback(() => {
    const group = new THREE.Group();

    // Base platform
    const baseGeo = new THREE.BoxGeometry(0.8, 0.2, 0.8);
    const baseMat = new THREE.MeshBasicMaterial({ color: COLORS.market });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.1;
    group.add(base);

    // Canopy
    const canopyGeo = new THREE.BoxGeometry(1, 0.1, 1);
    const canopyMat = new THREE.MeshBasicMaterial({ color: 0xc9302c });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.y = 0.8;
    group.add(canopy);

    // Poles
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6);
    const poleMat = new THREE.MeshBasicMaterial({ color: 0x8B4513 });
    const positions = [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]];
    positions.forEach(([px, pz]) => {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(px, 0.45, pz);
      group.add(pole);
    });

    return group;
  }, []);

  // Main scene setup
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene with fog
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.sky);
    scene.fog = new THREE.Fog(COLORS.fog, 10, 50);
    sceneRef.current = scene;

    // Perspective camera (FPV style)
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshBasicMaterial({ color: COLORS.ground });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    scene.add(ground);

    // Terrain group (will hold trees, mountains, etc.)
    const terrainGroup = new THREE.Group();
    terrainGroupRef.current = terrainGroup;
    scene.add(terrainGroup);

    // Initial fetch
    fetchTiles(agentPos.x, agentPos.y);

    // Animation loop
    let animationId: number;
    let targetCamPos = new THREE.Vector3();
    let targetLookAt = new THREE.Vector3();

    const animate = () => {
      animationId = requestAnimationFrame(animate);

      // Smooth camera follow
      if (camera) {
        // Camera behind and above agent, looking forward
        targetCamPos.set(0, 4, 8);
        targetLookAt.set(0, 1, -5);

        camera.position.lerp(targetCamPos, 0.05);

        // Update camera look direction
        const lookAtTarget = new THREE.Vector3();
        lookAtTarget.copy(targetLookAt);
        camera.lookAt(lookAtTarget);
      }

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
  }, []);

  // Fetch and update tiles when position changes
  const fetchTiles = useCallback(async (cx: number, cy: number) => {
    try {
      const response = await fetch(`/api/world/tiles?x=${cx}&y=${cy}&radius=${VIEW_RADIUS}`);
      const data = await response.json();
      if (data.success) {
        tilesRef.current = data.data.tiles;
        updateTerrain(data.data.tiles, cx, cy);
      }
    } catch (error) {
      console.error('Failed to fetch tiles:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Update terrain objects
  const updateTerrain = useCallback((tiles: Tile[], cx: number, cy: number) => {
    const terrainGroup = terrainGroupRef.current;
    const scene = sceneRef.current;
    if (!terrainGroup || !scene) return;

    // Clear existing terrain
    while (terrainGroup.children.length > 0) {
      terrainGroup.remove(terrainGroup.children[0]);
    }

    // Water plane (slightly below ground)
    const waterTiles = tiles.filter(t => t.terrain === 'water');
    if (waterTiles.length > 0) {
      const waterGeo = new THREE.PlaneGeometry(VIEW_RADIUS * 2.5, VIEW_RADIUS * 2.5);
      const waterMat = new THREE.MeshBasicMaterial({
        color: COLORS.water,
        transparent: true,
        opacity: 0.7
      });
      const water = new THREE.Mesh(waterGeo, waterMat);
      water.rotation.x = -Math.PI / 2;
      water.position.y = -0.05;
      terrainGroup.add(water);
    }

    // Add terrain objects based on tile type
    tiles.forEach((tile) => {
      const x = tile.x - cx;
      const z = tile.y - cy;

      // Add some randomness for natural feel
      const seed = (tile.x * 7 + tile.y * 13) % 100;
      const offsetX = (seed % 10 - 5) * 0.05;
      const offsetZ = ((seed * 3) % 10 - 5) * 0.05;

      switch (tile.terrain) {
        case 'forest': {
          // Multiple trees per forest tile
          const numTrees = 1 + (seed % 3);
          for (let i = 0; i < numTrees; i++) {
            const tree = createTree();
            const treeOffset = (i * 0.3) - 0.3;
            tree.position.set(x + offsetX + treeOffset, 0, z + offsetZ + (i % 2) * 0.2);
            tree.scale.setScalar(0.8 + (seed % 30) * 0.02);
            terrainGroup.add(tree);
          }
          break;
        }
        case 'mountain': {
          const height = 1.5 + (seed % 50) * 0.03;
          const mountain = createMountain(height);
          mountain.position.set(x + offsetX, 0, z + offsetZ);
          terrainGroup.add(mountain);
          break;
        }
        case 'market': {
          const market = createMarket();
          market.position.set(x, 0, z);
          terrainGroup.add(market);
          break;
        }
        case 'water': {
          // Water is handled as a plane above
          break;
        }
        // Plains are just ground - no extra objects
      }
    });
  }, [createTree, createMountain, createMarket]);

  // Update agents
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Clear existing agent meshes
    agentMeshesRef.current.forEach((mesh) => {
      scene.remove(mesh);
    });
    agentMeshesRef.current.clear();

    // Add agents
    agents.forEach((agent) => {
      const relX = agent.x - agentPos.x;
      const relZ = agent.y - agentPos.y;

      // Only show agents within view radius
      if (Math.abs(relX) > VIEW_RADIUS || Math.abs(relZ) > VIEW_RADIUS) {
        return;
      }

      const isSelected = agent.id === selectedAgentId;
      const crab = createCrabMesh(isSelected);

      // Selected agent at center, others relative
      if (isSelected) {
        crab.position.set(0, 0, 0);
        crab.scale.setScalar(1.2);
      } else {
        crab.position.set(relX, 0, relZ);
      }

      scene.add(crab);
      agentMeshesRef.current.set(agent.id, crab);
    });
  }, [agents, agentPos, selectedAgentId, createCrabMesh]);

  // Refetch tiles when position changes significantly
  useEffect(() => {
    fetchTiles(agentPos.x, agentPos.y);
  }, [agentPos.x, agentPos.y, fetchTiles]);

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden">
      {/* HUD Overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 p-3 pointer-events-none">
        <div className="flex justify-between items-start">
          {/* Agent Info */}
          <div className="pointer-events-auto bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2">
            <div className="text-white font-bold text-sm">{agentName || 'Agent'}</div>
            <div className="text-white/70 text-xs">Position: ({agentPos.x}, {agentPos.y})</div>
            <div className="text-green-400 text-xs mt-1 flex items-center gap-1">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Live
            </div>
          </div>

          {/* Close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="pointer-events-auto px-4 py-2 bg-black/50 backdrop-blur-sm hover:bg-black/70 rounded-lg text-white font-medium transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
          <div className="text-white text-center">
            <div className="text-2xl mb-2">🦀</div>
            <span>Entering world...</span>
          </div>
        </div>
      )}

      {/* Three.js canvas container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Compass / Direction indicator */}
      <div className="absolute bottom-4 right-4 z-10 bg-black/50 backdrop-blur-sm rounded-full w-16 h-16 flex items-center justify-center">
        <div className="text-white text-xs font-bold">
          <div className="text-center">N</div>
          <div className="flex justify-between px-1">
            <span>W</span>
            <span>E</span>
          </div>
          <div className="text-center">S</div>
        </div>
      </div>

      {/* Mini legend */}
      <div className="absolute bottom-4 left-4 z-10 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-white/80">
        <div className="flex gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#ff4444' }} /> You
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#ff8844' }} /> Others
          </span>
        </div>
      </div>
    </div>
  );
}
