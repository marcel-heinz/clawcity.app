'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { AgentPublic, Tile, TerrainType } from '@/lib/types';

// Terrain config: color + height (Pieter Levels style - pure geometry, no textures)
const TERRAIN_CONFIG: Record<TerrainType, { color: number; height: number }> = {
  plains:   { color: 0x7cb342, height: 0.1 },
  forest:   { color: 0x2d6b1e, height: 0.5 },
  mountain: { color: 0x78909c, height: 1.2 },
  water:    { color: 0x42a5f5, height: -0.15 },
  market:   { color: 0xd4a574, height: 0.2 },
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
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const [loading, setLoading] = useState(true);

  const VIEW_RADIUS = 10; // 21x21 grid

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    // Orthographic camera (isometric view - simple!)
    const aspect = width / height;
    const viewSize = 15;
    const camera = new THREE.OrthographicCamera(
      -viewSize * aspect, viewSize * aspect,
      viewSize, -viewSize,
      0.1, 1000
    );
    // Fixed isometric angle
    camera.position.set(20, 20, 20);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Fetch tiles and build scene
    fetchAndBuildScene(scene, centerX, centerY, agents, selectedAgentId);

    // Animation loop
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      const a = w / h;
      camera.left = -viewSize * a;
      camera.right = viewSize * a;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [centerX, centerY, agents, selectedAgentId]);

  async function fetchAndBuildScene(
    scene: THREE.Scene,
    cx: number,
    cy: number,
    agentList: AgentPublic[],
    selectedId?: string
  ) {
    try {
      const response = await fetch(
        `/api/world/tiles?x=${cx}&y=${cy}&radius=${VIEW_RADIUS}`
      );
      const data = await response.json();

      if (data.success) {
        buildTerrain(scene, data.data.tiles, cx, cy);
        buildAgents(scene, agentList, cx, cy, selectedId);
      }
    } catch (error) {
      console.error('Failed to fetch tiles:', error);
    } finally {
      setLoading(false);
    }
  }

  function buildTerrain(scene: THREE.Scene, tiles: Tile[], cx: number, cy: number) {
    // Reusable geometry
    const boxGeo = new THREE.BoxGeometry(0.95, 1, 0.95);

    // Create materials for each terrain type
    const materials: Record<TerrainType, THREE.MeshBasicMaterial> = {
      plains: new THREE.MeshBasicMaterial({ color: TERRAIN_CONFIG.plains.color }),
      forest: new THREE.MeshBasicMaterial({ color: TERRAIN_CONFIG.forest.color }),
      mountain: new THREE.MeshBasicMaterial({ color: TERRAIN_CONFIG.mountain.color }),
      water: new THREE.MeshBasicMaterial({ color: TERRAIN_CONFIG.water.color }),
      market: new THREE.MeshBasicMaterial({ color: TERRAIN_CONFIG.market.color }),
    };

    tiles.forEach((tile) => {
      const terrain = tile.terrain as TerrainType;
      const config = TERRAIN_CONFIG[terrain] || TERRAIN_CONFIG.plains;
      const material = materials[terrain] || materials.plains;

      const mesh = new THREE.Mesh(boxGeo, material);

      // Position: offset from center, scale height
      const x = tile.x - cx;
      const z = tile.y - cy;
      const y = config.height / 2; // Half height so top is at config.height

      mesh.position.set(x, y, z);
      mesh.scale.y = Math.max(0.1, config.height);

      scene.add(mesh);
    });

    // Add a subtle grid floor below water level
    const gridHelper = new THREE.GridHelper(VIEW_RADIUS * 2 + 1, VIEW_RADIUS * 2 + 1, 0x333333, 0x222222);
    gridHelper.position.y = -0.2;
    scene.add(gridHelper);
  }

  function buildAgents(
    scene: THREE.Scene,
    agentList: AgentPublic[],
    cx: number,
    cy: number,
    selectedId?: string
  ) {
    const sphereGeo = new THREE.SphereGeometry(0.3, 8, 6);

    agentList.forEach((agent) => {
      // Only show agents within view radius
      if (Math.abs(agent.x - cx) > VIEW_RADIUS || Math.abs(agent.y - cy) > VIEW_RADIUS) {
        return;
      }

      const isSelected = agent.id === selectedId;
      const color = isSelected ? 0xff4444 : 0xff8844;

      const material = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(sphereGeo, material);

      const x = agent.x - cx;
      const z = agent.y - cy;

      // Position agent on top of terrain (estimate height based on typical terrain)
      mesh.position.set(x, 0.8, z);

      // Make selected agent slightly larger
      if (isSelected) {
        mesh.scale.setScalar(1.3);
      }

      scene.add(mesh);
    });
  }

  return (
    <div className="relative w-full h-full min-h-[400px] bg-[#1a1a2e] rounded-lg overflow-hidden">
      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 px-3 py-1 bg-[var(--surface)] hover:bg-[var(--surface-hover)] rounded text-sm"
        >
          Close
        </button>
      )}

      {/* Coordinates display */}
      <div className="absolute top-2 left-2 z-10 px-2 py-1 bg-[var(--surface)]/80 rounded text-xs">
        Center: ({centerX}, {centerY})
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]/80 z-20">
          <span className="text-[var(--muted)]">Loading terrain...</span>
        </div>
      )}

      {/* Three.js canvas container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-10 flex gap-3 text-xs bg-[var(--surface)]/80 px-2 py-1 rounded">
        <span><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#7cb342' }} /> Plains</span>
        <span><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#2d6b1e' }} /> Forest</span>
        <span><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#78909c' }} /> Mountain</span>
        <span><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#42a5f5' }} /> Water</span>
        <span><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#d4a574' }} /> Market</span>
      </div>
    </div>
  );
}
