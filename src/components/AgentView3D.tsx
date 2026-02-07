'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { AgentPublic, Tile, TerrainType, WORLD_SIZE } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { CrabSprite } from '@/components/CrabSprite';

// ─── Color palette ───────────────────────────────────────────────────────────
const COLORS = {
  sky: 0x7ec8e3,
  skyHorizon: 0xc4e0f9,
  ground: 0x5a8f29,
  groundDark: 0x4a7a22,
  // Mountain
  mountainDark: 0x5a5a5a,
  mountainMid: 0x7a7a7a,
  mountainLight: 0x9a9a9a,
  mountainSnow: 0xf0f0f0,
  // Forest
  treeTrunk: 0x6b3a1f,
  treeLeaves: 0x1e6b1e,
  treeLeavesLight: 0x2d8a2d,
  treeLeavesTop: 0x3da03d,
  // Water
  water: 0x3a8fd4,
  waterFoam: 0x7ec8e3,
  // Market
  marketBase: 0xf5deb3,
  marketRoof: 0xb84c3c,
  marketDoor: 0x6b3a1f,
  // Agents
  agentSelf: 0xff4444,
  agentOther: 0xff8844,
  // Rocky
  rockyDark: 0x4a4a4a,
  rockyMid: 0x5a5a5a,
  rockyLight: 0x7a7a7a,
  // Sand
  sand: 0xe9c46a,
  sandDark: 0xd4a843,
  // Deep water
  deepWater: 0x1a3a6a,
  // Marsh
  marshWater: 0x4a7a6a,
  marshPlant: 0x2d6a4f,
  // Buildings
  storageWalls: 0xc4a06a,
  storageRoof: 0x8b6914,
  workshopWalls: 0x8a8a8a,
  workshopRoof: 0x5a3a1a,
  workshopChimney: 0x4a4a4a,
  fortWalls: 0x6a6a7a,
  fortTower: 0x5a5a6a,
  // Ambient
  sunColor: 0xfff5e6,
  ambientColor: 0x6688bb,
};

const BLOCK_SIZE = 1;

// Terrain colors for minimap
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

interface OtherAgentData {
  worldX: number;
  worldY: number;
  current: THREE.Vector3;
  target: THREE.Vector3;
  mesh: THREE.Group;
}

interface AgentView3DProps {
  centerX: number;
  centerY: number;
  agents: AgentPublic[];
  selectedAgentId?: string;
  mode?: 'follow' | 'spectator';
  onClose?: () => void;
}

// ─── Camera config ───────────────────────────────────────────────────────────
const CAMERA_HEIGHT = 6;        // Height above agent
const CAMERA_DISTANCE = 8;      // Distance behind agent
const CAMERA_LOOK_AHEAD = 2;    // How far ahead of agent to look
const CAMERA_FOV = 55;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 120;
const FOG_NEAR = 20;
const FOG_FAR = 60;

export function AgentView3D({ centerX, centerY, agents, selectedAgentId, mode = 'follow', onClose }: AgentView3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const agentGroupRef = useRef<THREE.Group | null>(null);
  const terrainGroupRef = useRef<THREE.Group | null>(null);
  const selfAgentRef = useRef<THREE.Group | null>(null);

  // Position tracking
  const currentPosRef = useRef({ x: centerX, y: centerY });
  const targetPosRef = useRef({ x: centerX, y: centerY });
  const otherAgentsRef = useRef<Map<string, OtherAgentData>>(new Map());

  // Spectator mode state
  const yawRef = useRef(0);
  const keysRef = useRef<Record<string, boolean>>({});
  const spectatorPosRef = useRef({ x: centerX, y: centerY });
  const spectatorVelRef = useRef({ x: 0, y: 0 }); // velocity for smooth boundary damping
  const terrainCenterRef = useRef({ x: Math.round(centerX), y: Math.round(centerY) });
  const isFetchingTerrainRef = useRef(false);
  const lastTerrainFetchRef = useRef(0);
  const isDraggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const joystickInputRef = useRef({ x: 0, y: 0 });
  const smoothedJoystickRef = useRef({ x: 0, y: 0 }); // smoothed joystick for mobile
  const lastTimeRef = useRef(0);
  const waterMeshesRef = useRef<THREE.Mesh[]>([]);
  const smoothCamPosRef = useRef(new THREE.Vector3());
  const smoothCamLookRef = useRef(new THREE.Vector3());
  const mobileRotateRef = useRef(0); // -1 = left, 0 = none, 1 = right
  // Pre-allocated Vector3s to avoid GC pressure in render loop
  const tmpTargetCamPos = useRef(new THREE.Vector3());
  const tmpTargetLookAt = useRef(new THREE.Vector3());
  // Per-tile chunk tracking for smooth streaming (no clear-and-rebuild)
  const loadedTilesRef = useRef<Map<string, THREE.Group>>(new Map());
  const loadedWaterRef = useRef<Map<string, THREE.Mesh>>(new Map());

  // Joystick visual state
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [joystickActive, setJoystickActive] = useState(false);
  const joystickPadRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [agentName, setAgentName] = useState('');
  const [displayPos, setDisplayPos] = useState({ x: centerX, y: centerY });
  const [currentTerrain, setCurrentTerrain] = useState<TerrainType>('plains');
  const [worldTiles, setWorldTiles] = useState<Tile[]>([]);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);

  const VIEW_RADIUS = 20;        // Tiles to load
  const UNLOAD_RADIUS = 24;      // Tiles before removal (hysteresis)
  const FETCH_THRESHOLD = 4;     // Refetch when player moves this far from last fetch center
  const MINIMAP_SIZE = 120;

  const isSpectator = mode === 'spectator';

  // Find selected agent's name
  useEffect(() => {
    if (!isSpectator) {
      const agent = agents.find(a => a.id === selectedAgentId);
      if (agent) setAgentName(agent.name);
    }
  }, [agents, selectedAgentId, isSpectator]);

  // ─── Mesh Creators ───────────────────────────────────────────────────────────

  const createCrabMesh = useCallback((color: number) => {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });

    // Body
    const bodyGeo = new THREE.BoxGeometry(0.5, 0.25, 0.4);
    const body = new THREE.Mesh(bodyGeo, mat);
    body.position.y = 0.2;
    body.castShadow = true;
    group.add(body);

    // Eyes
    const eyeGeo = new THREE.BoxGeometry(0.08, 0.1, 0.08);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.12, 0.38, 0.15);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.12, 0.38, 0.15);
    group.add(leftEye, rightEye);

    // Eye whites (small sphere)
    const whiteGeo = new THREE.SphereGeometry(0.03, 6, 6);
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const lw = new THREE.Mesh(whiteGeo, whiteMat);
    lw.position.set(-0.12, 0.42, 0.19);
    const rw = new THREE.Mesh(whiteGeo, whiteMat);
    rw.position.set(0.12, 0.42, 0.19);
    group.add(lw, rw);

    // Claws
    const clawGeo = new THREE.BoxGeometry(0.2, 0.15, 0.18);
    const leftClaw = new THREE.Mesh(clawGeo, mat);
    leftClaw.position.set(-0.42, 0.18, 0.12);
    leftClaw.castShadow = true;
    const rightClaw = new THREE.Mesh(clawGeo, mat);
    rightClaw.position.set(0.42, 0.18, 0.12);
    rightClaw.castShadow = true;
    group.add(leftClaw, rightClaw);

    // Legs (small cylinders)
    const legGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.15, 4);
    const legMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    for (let i = 0; i < 3; i++) {
      const ll = new THREE.Mesh(legGeo, legMat);
      ll.position.set(-0.2, 0.08, -0.1 + i * 0.15);
      ll.rotation.z = 0.4;
      group.add(ll);
      const rl = new THREE.Mesh(legGeo, legMat);
      rl.position.set(0.2, 0.08, -0.1 + i * 0.15);
      rl.rotation.z = -0.4;
      group.add(rl);
    }

    return group;
  }, []);

  const createMountain = useCallback((seed: number) => {
    const group = new THREE.Group();
    const height = 1.2 + (seed % 30) * 0.025;
    const baseRadius = 0.55 + (seed % 20) * 0.008;

    // Main mountain body - wider, shorter cone
    const mountainGeo = new THREE.ConeGeometry(baseRadius, height, 6);
    // Vary color between dark and mid grey based on seed
    const mountainColor = seed % 3 === 0 ? COLORS.mountainDark : seed % 3 === 1 ? COLORS.mountainMid : 0x686868;
    const mountainMat = new THREE.MeshStandardMaterial({
      color: mountainColor,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: true,
    });
    const mountain = new THREE.Mesh(mountainGeo, mountainMat);
    mountain.position.y = height * 0.5;
    mountain.castShadow = true;
    mountain.receiveShadow = true;
    group.add(mountain);

    // Small snow cap only on taller mountains
    if (height > 1.35) {
      const snowGeo = new THREE.ConeGeometry(baseRadius * 0.2, height * 0.12, 6);
      const snowMat = new THREE.MeshStandardMaterial({
        color: 0xdce4e8,
        roughness: 0.6,
      });
      const snow = new THREE.Mesh(snowGeo, snowMat);
      snow.position.y = height * 0.88;
      group.add(snow);
    }

    // Rocky base
    const baseGeo = new THREE.CylinderGeometry(baseRadius * 1.1, baseRadius * 1.2, 0.15, 6);
    const baseMat = new THREE.MeshStandardMaterial({
      color: COLORS.mountainDark,
      roughness: 0.95,
      flatShading: true,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.07;
    base.receiveShadow = true;
    group.add(base);

    // Small scattered rocks
    const rockGeo = new THREE.DodecahedronGeometry(0.08, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: COLORS.mountainDark, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 2; i++) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      const angle = ((seed + i * 137) % 360) * Math.PI / 180;
      rock.position.set(Math.cos(angle) * baseRadius * 0.95, 0.05, Math.sin(angle) * baseRadius * 0.95);
      rock.rotation.set(seed * 0.1, seed * 0.2, 0);
      rock.castShadow = true;
      group.add(rock);
    }

    return group;
  }, []);

  const createTree = useCallback((seed: number) => {
    const group = new THREE.Group();
    const treeHeight = 1.1 + (seed % 20) * 0.03;
    const trunkHeight = treeHeight * 0.35;

    // Trunk
    const trunkGeo = new THREE.CylinderGeometry(0.05, 0.09, trunkHeight, 6);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: COLORS.treeTrunk,
      roughness: 0.9,
    });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    group.add(trunk);

    // Foliage layers (pine tree style)
    const colors = [COLORS.treeLeaves, COLORS.treeLeavesLight, COLORS.treeLeavesTop];
    const layers = 3;
    for (let i = 0; i < layers; i++) {
      const layerRadius = 0.45 - (i * 0.1);
      const layerHeight = 0.45 - (i * 0.08);
      const foliageGeo = new THREE.ConeGeometry(layerRadius, layerHeight, 7);
      const foliageMat = new THREE.MeshStandardMaterial({
        color: colors[i],
        roughness: 0.8,
        flatShading: true,
      });
      const foliage = new THREE.Mesh(foliageGeo, foliageMat);
      foliage.position.y = trunkHeight + (i * 0.22) + 0.18;
      foliage.castShadow = true;
      foliage.receiveShadow = true;
      group.add(foliage);
    }

    return group;
  }, []);

  const createMarket = useCallback((_seed: number) => {
    const group = new THREE.Group();

    // Main building walls
    const wallGeo = new THREE.BoxGeometry(0.85, 0.75, 0.65);
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.marketBase, roughness: 0.7 });
    const walls = new THREE.Mesh(wallGeo, wallMat);
    walls.position.y = 0.375;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    // Peaked roof
    const roofGeo = new THREE.ConeGeometry(0.65, 0.38, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: COLORS.marketRoof, roughness: 0.6 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 0.95;
    roof.scale.set(1, 1, 0.78);
    roof.castShadow = true;
    group.add(roof);

    // Door
    const doorGeo = new THREE.BoxGeometry(0.18, 0.38, 0.04);
    const doorMat = new THREE.MeshStandardMaterial({ color: COLORS.marketDoor, roughness: 0.8 });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 0.19, 0.34);
    group.add(door);

    // Windows
    const winGeo = new THREE.BoxGeometry(0.12, 0.12, 0.04);
    const winMat = new THREE.MeshStandardMaterial({ color: 0xffe08a, roughness: 0.2, emissive: 0xffe08a, emissiveIntensity: 0.3 });
    const win1 = new THREE.Mesh(winGeo, winMat);
    win1.position.set(-0.24, 0.5, 0.34);
    const win2 = new THREE.Mesh(winGeo, winMat);
    win2.position.set(0.24, 0.5, 0.34);
    group.add(win1, win2);

    // Market sign/awning
    const awningGeo = new THREE.BoxGeometry(0.95, 0.04, 0.28);
    const awningMat = new THREE.MeshStandardMaterial({ color: 0xc83232, roughness: 0.5 });
    const awning = new THREE.Mesh(awningGeo, awningMat);
    awning.position.set(0, 0.68, 0.48);
    awning.rotation.x = -0.15;
    awning.castShadow = true;
    group.add(awning);

    return group;
  }, []);

  const createWater = useCallback(() => {
    const geo = new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.water,
      transparent: true,
      opacity: 0.8,
      roughness: 0.1,
      metalness: 0.3,
    });
    const water = new THREE.Mesh(geo, mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.05;
    water.receiveShadow = true;
    return water;
  }, []);

  const createRocky = useCallback((seed: number) => {
    const group = new THREE.Group();
    const rockColors = [COLORS.rockyDark, COLORS.rockyMid, COLORS.rockyLight];
    const numRocks = 3 + (seed % 3);

    for (let i = 0; i < numRocks; i++) {
      const size = 0.08 + ((seed + i * 17) % 20) * 0.01;
      const rockGeo = new THREE.DodecahedronGeometry(size, 0);
      const rockMat = new THREE.MeshStandardMaterial({
        color: rockColors[(seed + i) % 3],
        roughness: 0.95,
        flatShading: true,
      });
      const rock = new THREE.Mesh(rockGeo, rockMat);
      const angle = ((seed + i * 97) % 360) * Math.PI / 180;
      const dist = 0.1 + ((seed + i * 31) % 20) * 0.015;
      rock.position.set(Math.cos(angle) * dist, size * 0.6, Math.sin(angle) * dist);
      rock.rotation.set(seed * 0.1 + i, seed * 0.2 + i * 0.5, 0);
      rock.castShadow = true;
      rock.receiveShadow = true;
      group.add(rock);
    }

    return group;
  }, []);

  const createSand = useCallback((seed: number) => {
    const group = new THREE.Group();

    const sandBase = new THREE.Mesh(
      new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE),
      new THREE.MeshStandardMaterial({ color: COLORS.sand, roughness: 0.9 })
    );
    sandBase.rotation.x = -Math.PI / 2;
    sandBase.position.y = 0.01;
    sandBase.receiveShadow = true;
    group.add(sandBase);

    // Dune mound
    const duneGeo = new THREE.SphereGeometry(0.18, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    const duneMat = new THREE.MeshStandardMaterial({ color: COLORS.sandDark, roughness: 0.95 });
    const dune = new THREE.Mesh(duneGeo, duneMat);
    const angle = (seed * 47 % 360) * Math.PI / 180;
    dune.position.set(Math.cos(angle) * 0.2, 0, Math.sin(angle) * 0.15);
    dune.scale.set(1.5, 0.4, 1);
    dune.receiveShadow = true;
    group.add(dune);

    return group;
  }, []);

  const createDeepWater = useCallback(() => {
    const dw = new THREE.Mesh(
      new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE),
      new THREE.MeshStandardMaterial({
        color: COLORS.deepWater,
        transparent: true,
        opacity: 0.88,
        roughness: 0.05,
        metalness: 0.4,
      })
    );
    dw.rotation.x = -Math.PI / 2;
    dw.position.y = -0.1;
    dw.receiveShadow = true;
    return dw;
  }, []);

  const createMarsh = useCallback((seed: number) => {
    const group = new THREE.Group();

    const mw = new THREE.Mesh(
      new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE),
      new THREE.MeshStandardMaterial({ color: COLORS.marshWater, transparent: true, opacity: 0.7, roughness: 0.2, metalness: 0.1 })
    );
    mw.rotation.x = -Math.PI / 2;
    mw.position.y = 0.01;
    mw.receiveShadow = true;
    group.add(mw);

    // Cattails
    const numReeds = 2 + (seed % 3);
    for (let i = 0; i < numReeds; i++) {
      const reedGroup = new THREE.Group();
      const stalkGeo = new THREE.CylinderGeometry(0.012, 0.018, 0.45, 5);
      const stalkMat = new THREE.MeshStandardMaterial({ color: 0x556b2f, roughness: 0.8 });
      const stalk = new THREE.Mesh(stalkGeo, stalkMat);
      stalk.position.y = 0.22;
      stalk.castShadow = true;
      reedGroup.add(stalk);

      const topGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.1, 6);
      const topMat = new THREE.MeshStandardMaterial({ color: 0x654321, roughness: 0.9 });
      const top = new THREE.Mesh(topGeo, topMat);
      top.position.y = 0.42;
      reedGroup.add(top);

      const angle = ((seed + i * 120) % 360) * Math.PI / 180;
      const dist = 0.1 + ((seed + i * 43) % 15) * 0.02;
      reedGroup.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      reedGroup.rotation.z = ((seed + i) % 10 - 5) * 0.02;
      group.add(reedGroup);
    }

    return group;
  }, []);

  // ─── Building Creators ────────────────────────────────────────────────────────

  const createStorageBuilding = useCallback((_seed: number) => {
    const group = new THREE.Group();

    // Main warehouse body
    const wallGeo = new THREE.BoxGeometry(0.8, 0.6, 0.7);
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.storageWalls, roughness: 0.75 });
    const walls = new THREE.Mesh(wallGeo, wallMat);
    walls.position.y = 0.3;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    // Sloped roof (box stretched)
    const roofGeo = new THREE.BoxGeometry(0.9, 0.08, 0.8);
    const roofMat = new THREE.MeshStandardMaterial({ color: COLORS.storageRoof, roughness: 0.6 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 0.64;
    roof.castShadow = true;
    group.add(roof);

    // Ridge line
    const ridgeGeo = new THREE.BoxGeometry(0.92, 0.06, 0.15);
    const ridge = new THREE.Mesh(ridgeGeo, roofMat);
    ridge.position.y = 0.7;
    group.add(ridge);

    // Large door
    const doorGeo = new THREE.BoxGeometry(0.35, 0.45, 0.04);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.8 });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 0.22, 0.36);
    group.add(door);

    // Crate decorations on sides
    const crateGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.85 });
    const crate1 = new THREE.Mesh(crateGeo, crateMat);
    crate1.position.set(0.5, 0.08, 0.15);
    crate1.castShadow = true;
    group.add(crate1);
    const crate2 = new THREE.Mesh(crateGeo, crateMat);
    crate2.position.set(0.5, 0.08, -0.1);
    crate2.rotation.y = 0.3;
    crate2.castShadow = true;
    group.add(crate2);

    return group;
  }, []);

  const createWorkshopBuilding = useCallback((_seed: number) => {
    const group = new THREE.Group();

    // Main structure
    const wallGeo = new THREE.BoxGeometry(0.75, 0.7, 0.65);
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.workshopWalls, roughness: 0.8 });
    const walls = new THREE.Mesh(wallGeo, wallMat);
    walls.position.y = 0.35;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    // Peaked roof
    const roofGeo = new THREE.ConeGeometry(0.58, 0.35, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: COLORS.workshopRoof, roughness: 0.7 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 0.88;
    roof.scale.set(1, 1, 0.82);
    roof.castShadow = true;
    group.add(roof);

    // Chimney
    const chimneyGeo = new THREE.BoxGeometry(0.12, 0.4, 0.12);
    const chimneyMat = new THREE.MeshStandardMaterial({ color: COLORS.workshopChimney, roughness: 0.9 });
    const chimney = new THREE.Mesh(chimneyGeo, chimneyMat);
    chimney.position.set(0.2, 0.95, -0.15);
    chimney.castShadow = true;
    group.add(chimney);

    // Anvil (small box + cylinder)
    const anvilGeo = new THREE.BoxGeometry(0.18, 0.1, 0.1);
    const anvilMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.3, metalness: 0.7 });
    const anvil = new THREE.Mesh(anvilGeo, anvilMat);
    anvil.position.set(-0.5, 0.05, 0.25);
    anvil.castShadow = true;
    group.add(anvil);

    // Forge glow (emissive window)
    const glowGeo = new THREE.BoxGeometry(0.12, 0.12, 0.04);
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xff6622,
      emissive: 0xff4400,
      emissiveIntensity: 0.6,
      roughness: 0.3,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(0, 0.35, 0.34);
    group.add(glow);

    return group;
  }, []);

  const createFortificationBuilding = useCallback((_seed: number) => {
    const group = new THREE.Group();

    // Base wall (wide, low)
    const wallGeo = new THREE.BoxGeometry(0.9, 0.5, 0.9);
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.fortWalls, roughness: 0.85, flatShading: true });
    const walls = new THREE.Mesh(wallGeo, wallMat);
    walls.position.y = 0.25;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    // Battlements (crenellations)
    const bGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const bMat = new THREE.MeshStandardMaterial({ color: COLORS.fortWalls, roughness: 0.85, flatShading: true });
    const positions = [
      [-0.35, 0.58, -0.35], [0, 0.58, -0.35], [0.35, 0.58, -0.35],
      [-0.35, 0.58, 0.35], [0, 0.58, 0.35], [0.35, 0.58, 0.35],
      [-0.35, 0.58, 0], [0.35, 0.58, 0],
    ];
    positions.forEach(([px, py, pz]) => {
      const b = new THREE.Mesh(bGeo, bMat);
      b.position.set(px, py, pz);
      b.castShadow = true;
      group.add(b);
    });

    // Corner tower
    const towerGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.85, 6);
    const towerMat = new THREE.MeshStandardMaterial({ color: COLORS.fortTower, roughness: 0.8, flatShading: true });
    const tower = new THREE.Mesh(towerGeo, towerMat);
    tower.position.set(0.4, 0.42, 0.4);
    tower.castShadow = true;
    group.add(tower);

    // Tower cap
    const capGeo = new THREE.ConeGeometry(0.16, 0.2, 6);
    const capMat = new THREE.MeshStandardMaterial({ color: COLORS.marketRoof, roughness: 0.6 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(0.4, 0.92, 0.4);
    group.add(cap);

    // Gate
    const gateGeo = new THREE.BoxGeometry(0.22, 0.35, 0.06);
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 });
    const gate = new THREE.Mesh(gateGeo, gateMat);
    gate.position.set(0, 0.17, 0.46);
    group.add(gate);

    return group;
  }, []);

  // ─── Fetch tiles ──────────────────────────────────────────────────────────────

  const fetchTiles = useCallback(async (cx: number, cy: number) => {
    try {
      const response = await fetch(`/api/world/tiles?x=${cx}&y=${cy}&radius=${VIEW_RADIUS}`);
      const data = await response.json();
      if (data.success) return data.data.tiles as Tile[];
    } catch (error) {
      console.error('Failed to fetch tiles:', error);
    }
    return [];
  }, []);

  const fetchWorldTiles = useCallback(async () => {
    try {
      const response = await fetch(`/api/world/tiles?x=${WORLD_SIZE / 2}&y=${WORLD_SIZE / 2}&radius=${WORLD_SIZE / 2}&sample=5`);
      const data = await response.json();
      if (data.success) setWorldTiles(data.data.tiles as Tile[]);
    } catch (error) {
      console.error('Failed to fetch world tiles:', error);
    }
  }, []);

  useEffect(() => { fetchWorldTiles(); }, [fetchWorldTiles]);

  // ─── Create single tile group (used by streaming system) ───────────────────────

  const createTileGroup = useCallback((tile: Tile, worldOffsetX: number, worldOffsetZ: number) => {
    const tileGroup = new THREE.Group();
    const seed = (tile.x * 7 + tile.y * 13) % 100;
    const offsetX = (seed % 10 - 5) * 0.02;
    const offsetZ = ((seed * 3) % 10 - 5) * 0.02;

    // Store world coordinates for repositioning when center shifts
    tileGroup.userData.worldX = tile.x;
    tileGroup.userData.worldY = tile.y;
    // Position group at world position (will be offset by terrainGroup.position)
    tileGroup.position.set(tile.x - worldOffsetX, 0, tile.y - worldOffsetZ);

    // Ground tile
    const groundGeo = new THREE.PlaneGeometry(BLOCK_SIZE * 1.01, BLOCK_SIZE * 1.01);
    const groundColor = tile.terrain === 'plains' ? (seed % 2 === 0 ? COLORS.ground : COLORS.groundDark) : COLORS.ground;
    const groundMat = new THREE.MeshStandardMaterial({ color: groundColor, roughness: 0.9 });
    const groundTile = new THREE.Mesh(groundGeo, groundMat);
    groundTile.rotation.x = -Math.PI / 2;
    groundTile.receiveShadow = true;
    tileGroup.add(groundTile);

    // Territory owner indicator
    if (tile.owner_id) {
      const borderGeo = new THREE.PlaneGeometry(BLOCK_SIZE * 0.95, BLOCK_SIZE * 0.95);
      const borderMat = new THREE.MeshStandardMaterial({
        color: 0x44ff44, transparent: true, opacity: 0.12, roughness: 0.5,
      });
      const border = new THREE.Mesh(borderGeo, borderMat);
      border.rotation.x = -Math.PI / 2;
      border.position.y = 0.005;
      tileGroup.add(border);
    }

    // Building replaces terrain object
    if (tile.building_type) {
      let building: THREE.Object3D | null = null;
      switch (tile.building_type) {
        case 'storage': building = createStorageBuilding(seed); break;
        case 'workshop': building = createWorkshopBuilding(seed); break;
        case 'fortification': building = createFortificationBuilding(seed); break;
      }
      if (building) tileGroup.add(building);
    } else {
      let obj: THREE.Object3D | null = null;
      switch (tile.terrain) {
        case 'mountain': obj = createMountain(seed); break;
        case 'forest': obj = createTree(seed); break;
        case 'market': obj = createMarket(seed); break;
        case 'water':
          obj = createWater();
          break;
        case 'rocky': obj = createRocky(seed); break;
        case 'sand': obj = createSand(seed); break;
        case 'deep_water':
          obj = createDeepWater();
          break;
        case 'marsh': obj = createMarsh(seed); break;
      }
      if (obj) {
        obj.position.set(offsetX, 0, offsetZ);
        tileGroup.add(obj);
      }
    }

    return tileGroup;
  }, [createMountain, createTree, createMarket, createWater, createRocky, createSand, createDeepWater, createMarsh, createStorageBuilding, createWorkshopBuilding, createFortificationBuilding]);

  // ─── Incremental terrain streaming (add new tiles, remove far tiles) ──────────

  const streamTerrain = useCallback((tiles: Tile[], cx: number, cy: number) => {
    const terrainGroup = terrainGroupRef.current;
    if (!terrainGroup) return;

    // Find current tile for terrain display
    const currentTile = tiles.find(t => t.x === Math.floor(cx) && t.y === Math.floor(cy));
    if (currentTile) setCurrentTerrain(currentTile.terrain);

    // Track which tiles are in the new set
    const newTileKeys = new Set<string>();
    const newWaterMeshes: THREE.Mesh[] = [];

    // Add tiles that aren't already loaded
    tiles.forEach(tile => {
      const key = `${tile.x},${tile.y}`;
      newTileKeys.add(key);

      if (!loadedTilesRef.current.has(key)) {
        const tileGroup = createTileGroup(tile, cx, cy);
        terrainGroup.add(tileGroup);
        loadedTilesRef.current.set(key, tileGroup);

        // Track water meshes for animation
        if (tile.terrain === 'water' || tile.terrain === 'deep_water') {
          tileGroup.children.forEach(child => {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial && child.material.transparent) {
              loadedWaterRef.current.set(key, child);
            }
          });
        }
      }
    });

    // Reposition ALL loaded tiles relative to new center (not just those in current response)
    // This fixes the bug where tiles between VIEW_RADIUS and UNLOAD_RADIUS
    // kept stale positions when the center shifted
    const keysToRemove: string[] = [];
    loadedTilesRef.current.forEach((group, key) => {
      const wx = group.userData.worldX as number;
      const wy = group.userData.worldY as number;
      // Remove tiles outside UNLOAD_RADIUS (hysteresis: load at VIEW_RADIUS, unload at UNLOAD_RADIUS)
      if (Math.abs(wx - cx) > UNLOAD_RADIUS || Math.abs(wy - cy) > UNLOAD_RADIUS) {
        terrainGroup.remove(group);
        keysToRemove.push(key);
        loadedWaterRef.current.delete(key);
      } else {
        // Reposition relative to new center
        group.position.set(wx - cx, 0, wy - cy);
      }
    });
    keysToRemove.forEach(k => loadedTilesRef.current.delete(k));

    // Update water mesh list for animation
    waterMeshesRef.current = Array.from(loadedWaterRef.current.values());
  }, [createTileGroup, UNLOAD_RADIUS]);

  // Legacy buildTerrain for initial load / follow mode (full rebuild)
  const buildTerrain = useCallback((tiles: Tile[], cx: number, cy: number) => {
    const terrainGroup = terrainGroupRef.current;
    if (!terrainGroup) return;

    // Clear all tracked tiles
    loadedTilesRef.current.forEach(group => terrainGroup.remove(group));
    loadedTilesRef.current.clear();
    loadedWaterRef.current.clear();
    waterMeshesRef.current = [];

    // Use streaming to add all tiles
    streamTerrain(tiles, cx, cy);
  }, [streamTerrain]);

  // ─── Update minimap ───────────────────────────────────────────────────────────

  const updateMinimap = useCallback(() => {
    const canvas = minimapCanvasRef.current;
    if (!canvas || worldTiles.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = MINIMAP_SIZE / WORLD_SIZE;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    worldTiles.forEach(tile => {
      ctx.fillStyle = TERRAIN_COLORS[tile.terrain] || '#555';
      ctx.fillRect(tile.x * scale, tile.y * scale, Math.ceil(scale), Math.ceil(scale));
    });

    // Position marker
    ctx.fillStyle = '#ff4444';
    ctx.beginPath();
    ctx.arc(displayPos.x * scale, displayPos.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();

    if (isSpectator) {
      const yaw = yawRef.current;
      const markerLen = 6;
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(displayPos.x * scale, displayPos.y * scale);
      ctx.lineTo(
        displayPos.x * scale - Math.sin(yaw) * markerLen,
        displayPos.y * scale - Math.cos(yaw) * markerLen
      );
      ctx.stroke();
    }
  }, [worldTiles, displayPos, isSpectator]);

  useEffect(() => { updateMinimap(); }, [updateMinimap]);

  // ─── Keyboard events (spectator mode) ─────────────────────────────────────────

  useEffect(() => {
    if (!isSpectator) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        e.preventDefault();
        keysRef.current[key] = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [isSpectator]);

  // Pointer drag for camera rotation (spectator mode)
  useEffect(() => {
    if (!isSpectator) return;
    const container = containerRef.current;
    if (!container) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-spectator-ui]')) return;
      isDraggingRef.current = true;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    const handlePointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - lastPointerRef.current.x;
      yawRef.current += dx * 0.005;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    const handlePointerUp = () => { isDraggingRef.current = false; };

    container.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isSpectator]);

  // ─── Main scene setup ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.sky);
    scene.fog = new THREE.Fog(COLORS.sky, FOG_NEAR, FOG_FAR);
    sceneRef.current = scene;

    // Camera - elevated third-person view
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, width / height, CAMERA_NEAR, CAMERA_FAR);
    camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
    camera.lookAt(0, 0, -CAMERA_LOOK_AHEAD);
    cameraRef.current = camera;

    // Renderer with shadows
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ─── Lighting ─────────────────────────────────────────────────────────────

    // Hemisphere light (sky + ground bounce)
    const hemiLight = new THREE.HemisphereLight(0x88bbff, 0x445522, 0.5);
    scene.add(hemiLight);

    // Ambient light (fill)
    const ambientLight = new THREE.AmbientLight(COLORS.ambientColor, 0.3);
    scene.add(ambientLight);

    // Directional light (sun) with shadows
    const sunLight = new THREE.DirectionalLight(COLORS.sunColor, 1.2);
    sunLight.position.set(15, 20, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 60;
    sunLight.shadow.camera.left = -20;
    sunLight.shadow.camera.right = 20;
    sunLight.shadow.camera.top = 20;
    sunLight.shadow.camera.bottom = -20;
    sunLight.shadow.bias = -0.001;
    scene.add(sunLight);
    scene.add(sunLight.target);

    // ─── Ground plane ─────────────────────────────────────────────────────────

    const groundGeo = new THREE.PlaneGeometry(120, 120);
    const groundMat = new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    // Terrain group
    const terrainGroup = new THREE.Group();
    terrainGroupRef.current = terrainGroup;
    scene.add(terrainGroup);

    // Agent group
    const agentGroup = new THREE.Group();
    agentGroupRef.current = agentGroup;
    scene.add(agentGroup);

    // Initialize smooth camera positions
    smoothCamPosRef.current.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
    smoothCamLookRef.current.set(0, 0, -CAMERA_LOOK_AHEAD);

    // Create self agent mesh (for follow mode)
    if (!isSpectator) {
      const selfAgent = createCrabMesh(COLORS.agentSelf);
      selfAgent.position.set(0, 0, 0);
      agentGroup.add(selfAgent);
      selfAgentRef.current = selfAgent;
    }

    // Initial load
    fetchTiles(centerX, centerY).then(tiles => {
      buildTerrain(tiles, centerX, centerY);
      setLoading(false);
    });

    lastTimeRef.current = performance.now();

    // ─── Animation loop ─────────────────────────────────────────────────────────

    let animationId: number;
    let lastDisplayUpdateTime = 0;
    let elapsedTime = 0;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;
      elapsedTime += dt;

      // Animate water
      waterMeshesRef.current.forEach(mesh => {
        mesh.position.y = -0.05 + Math.sin(elapsedTime * 1.5 + mesh.position.x * 2) * 0.015;
      });

      if (isSpectator) {
        // ── SPECTATOR MODE ──────────────────────────────────────────────────
        const MOVE_SPEED = 5;
        const ROTATE_SPEED = 2;
        const BOUNDARY_MARGIN = 15;       // Soft zone width (tiles) before world edge
        const BOUNDARY_MIN_SPEED = 0.05;  // Minimum speed multiplier at the very edge
        const yaw = yawRef.current;
        const keys = keysRef.current;

        // Smooth joystick input to avoid jerky mobile movement
        const rawJoystick = joystickInputRef.current;
        const smoothJoy = smoothedJoystickRef.current;
        const joyDamp = 1 - Math.exp(-12 * dt); // fast but smooth input damping
        smoothJoy.x += (rawJoystick.x - smoothJoy.x) * joyDamp;
        smoothJoy.y += (rawJoystick.y - smoothJoy.y) * joyDamp;

        const forwardX = -Math.sin(yaw);
        const forwardZ = -Math.cos(yaw);
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);

        let moveX = 0, moveZ = 0;
        if (keys['w'] || keys['arrowup']) { moveX += forwardX; moveZ += forwardZ; }
        if (keys['s'] || keys['arrowdown']) { moveX -= forwardX; moveZ -= forwardZ; }
        if (keys['a']) { moveX -= rightX; moveZ -= rightZ; }
        if (keys['d']) { moveX += rightX; moveZ += rightZ; }
        if (keys['arrowleft']) yawRef.current += ROTATE_SPEED * dt;
        if (keys['arrowright']) yawRef.current -= ROTATE_SPEED * dt;

        // Joystick input (mobile) - forward/back + strafe left/right (like WASD)
        if (smoothJoy.x !== 0 || smoothJoy.y !== 0) {
          moveX += forwardX * (-smoothJoy.y) + rightX * smoothJoy.x;
          moveZ += forwardZ * (-smoothJoy.y) + rightZ * smoothJoy.x;
        }

        // Mobile rotate buttons
        const mobileRotate = mobileRotateRef.current;
        if (mobileRotate !== 0) {
          yawRef.current += mobileRotate * ROTATE_SPEED * dt;
        }

        const mag = Math.sqrt(moveX * moveX + moveZ * moveZ);
        if (mag > 0) {
          // Compute per-axis boundary damping: smoothly reduce speed as we approach edges
          const pos = spectatorPosRef.current;
          const edgeMax = WORLD_SIZE - 1;

          // How much speed to allow along each axis based on proximity to boundary
          const dampAxis = (p: number, dir: number): number => {
            if (dir > 0) {
              // Moving toward max edge
              const dist = edgeMax - p;
              if (dist <= 0) return 0;
              if (dist < BOUNDARY_MARGIN) {
                const t = dist / BOUNDARY_MARGIN; // 0 at edge, 1 at margin
                return BOUNDARY_MIN_SPEED + (1 - BOUNDARY_MIN_SPEED) * (t * t * (3 - 2 * t)); // smoothstep
              }
            } else if (dir < 0) {
              // Moving toward min edge
              const dist = p;
              if (dist <= 0) return 0;
              if (dist < BOUNDARY_MARGIN) {
                const t = dist / BOUNDARY_MARGIN;
                return BOUNDARY_MIN_SPEED + (1 - BOUNDARY_MIN_SPEED) * (t * t * (3 - 2 * t));
              }
            }
            return 1;
          };

          const dirX = moveX / mag;
          const dirZ = moveZ / mag;
          const dampX = dampAxis(pos.x, dirX);
          const dampZ = dampAxis(pos.y, dirZ);

          const speed = MOVE_SPEED * dt;
          pos.x += dirX * speed * dampX;
          pos.y += dirZ * speed * dampZ;

          // Absolute hard clamp as safety net (should rarely engage due to damping)
          pos.x = Math.max(0, Math.min(edgeMax, pos.x));
          pos.y = Math.max(0, Math.min(edgeMax, pos.y));
        }

        if (now - lastDisplayUpdateTime > 100) {
          lastDisplayUpdateTime = now;
          const roundedX = Math.round(spectatorPosRef.current.x);
          const roundedY = Math.round(spectatorPosRef.current.y);
          setDisplayPos(prev => prev.x !== roundedX || prev.y !== roundedY ? { x: roundedX, y: roundedY } : prev);
        }

        const tc = terrainCenterRef.current;
        const localX = spectatorPosRef.current.x - tc.x;
        const localZ = spectatorPosRef.current.y - tc.y;
        const currentYaw = yawRef.current;

        // Third-person camera for spectator: elevated, looking down
        // Use pre-allocated Vector3s to avoid GC pressure on mobile
        const camOffsetX = Math.sin(currentYaw) * CAMERA_DISTANCE;
        const camOffsetZ = Math.cos(currentYaw) * CAMERA_DISTANCE;
        tmpTargetCamPos.current.set(localX + camOffsetX, CAMERA_HEIGHT, localZ + camOffsetZ);
        tmpTargetLookAt.current.set(
          localX - Math.sin(currentYaw) * CAMERA_LOOK_AHEAD,
          0,
          localZ - Math.cos(currentYaw) * CAMERA_LOOK_AHEAD
        );
        // Frame-rate independent smoothing: lambda=6 gives snappy but smooth follow
        const camLerp = 1 - Math.exp(-6 * dt);
        smoothCamPosRef.current.lerp(tmpTargetCamPos.current, camLerp);
        smoothCamLookRef.current.lerp(tmpTargetLookAt.current, camLerp);
        camera.position.copy(smoothCamPosRef.current);
        camera.lookAt(smoothCamLookRef.current);

        // Sun follows camera
        sunLight.position.set(localX + 15, 20, localZ + 10);
        sunLight.target.position.set(localX, 0, localZ);

        ground.position.x = localX;
        ground.position.z = localZ;

        // Streaming terrain check - fetch early, stream incrementally
        const distFromCenter = Math.sqrt(
          (spectatorPosRef.current.x - tc.x) ** 2 +
          (spectatorPosRef.current.y - tc.y) ** 2
        );

        if (distFromCenter > FETCH_THRESHOLD && !isFetchingTerrainRef.current && now - lastTerrainFetchRef.current > 300) {
          lastTerrainFetchRef.current = now;
          isFetchingTerrainRef.current = true;
          const newCx = Math.round(spectatorPosRef.current.x);
          const newCy = Math.round(spectatorPosRef.current.y);

          fetchTiles(newCx, newCy).then(tiles => {
            terrainCenterRef.current = { x: newCx, y: newCy };
            // Use incremental streaming instead of full rebuild
            streamTerrain(tiles, newCx, newCy);
            // Reposition agents
            otherAgentsRef.current.forEach((agentData, agentId) => {
              const relX = agentData.worldX - newCx;
              const relZ = agentData.worldY - newCy;
              if (Math.abs(relX) > UNLOAD_RADIUS || Math.abs(relZ) > UNLOAD_RADIUS) {
                agentGroupRef.current?.remove(agentData.mesh);
                otherAgentsRef.current.delete(agentId);
              } else {
                agentData.target.set(relX, 0, relZ);
                agentData.current.set(relX, 0, relZ);
                agentData.mesh.position.set(relX, 0, relZ);
              }
            });
            isFetchingTerrainRef.current = false;
          });
        }
      } else {
        // ── FOLLOW MODE ─────────────────────────────────────────────────────
        // Frame-rate independent smoothing (lambda=4 for smooth camera follow)
        const followLerp = 1 - Math.exp(-4 * dt);
        currentPosRef.current.x += (targetPosRef.current.x - currentPosRef.current.x) * followLerp;
        currentPosRef.current.y += (targetPosRef.current.y - currentPosRef.current.y) * followLerp;

        // Camera behind and above the agent
        camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
        camera.lookAt(0, 0.3, -CAMERA_LOOK_AHEAD);

        // Keep sun tracking
        sunLight.position.set(15, 20, 10);
        sunLight.target.position.set(0, 0, 0);
      }

      // Interpolate other agents (frame-rate independent)
      const agentLerp = 1 - Math.exp(-5 * dt);
      otherAgentsRef.current.forEach((agentData) => {
        agentData.current.lerp(agentData.target, agentLerp);
        agentData.mesh.position.copy(agentData.current);
      });

      // Gentle bob for self agent
      if (selfAgentRef.current) {
        selfAgentRef.current.position.y = Math.sin(elapsedTime * 2) * 0.02;
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [centerX, centerY, isSpectator, fetchTiles, buildTerrain, streamTerrain, createCrabMesh]);

  // ─── Supabase Realtime subscription ────────────────────────────────────────────

  useEffect(() => {
    let isMounted = true;

    const getCenter = () => isSpectator ? terrainCenterRef.current : targetPosRef.current;

    const handleAgentUpdate = async (payload: { new: { id: string; x: number; y: number; name: string } }) => {
      if (!isMounted) return;
      const updatedAgent = payload.new;

      if (!isSpectator && updatedAgent.id === selectedAgentId) {
        const oldX = targetPosRef.current.x;
        const oldY = targetPosRef.current.y;
        targetPosRef.current.x = updatedAgent.x;
        targetPosRef.current.y = updatedAgent.y;
        setDisplayPos({ x: updatedAgent.x, y: updatedAgent.y });

        if (Math.abs(updatedAgent.x - oldX) > 0 || Math.abs(updatedAgent.y - oldY) > 0) {
          const tiles = await fetchTiles(updatedAgent.x, updatedAgent.y);
          buildTerrain(tiles, updatedAgent.x, updatedAgent.y);
        }
      } else {
        const agentGroup = agentGroupRef.current;
        if (!agentGroup) return;

        const center = getCenter();
        const relX = updatedAgent.x - center.x;
        const relZ = updatedAgent.y - center.y;

        if (Math.abs(relX) > VIEW_RADIUS || Math.abs(relZ) > VIEW_RADIUS) {
          const existing = otherAgentsRef.current.get(updatedAgent.id);
          if (existing) {
            agentGroup.remove(existing.mesh);
            otherAgentsRef.current.delete(updatedAgent.id);
          }
          return;
        }

        const existing = otherAgentsRef.current.get(updatedAgent.id);
        if (existing) {
          existing.target.set(relX, 0, relZ);
          existing.worldX = updatedAgent.x;
          existing.worldY = updatedAgent.y;
        } else {
          const mesh = createCrabMesh(COLORS.agentOther);
          mesh.position.set(relX, 0, relZ);
          agentGroup.add(mesh);
          otherAgentsRef.current.set(updatedAgent.id, {
            worldX: updatedAgent.x,
            worldY: updatedAgent.y,
            current: new THREE.Vector3(relX, 0, relZ),
            target: new THREE.Vector3(relX, 0, relZ),
            mesh
          });
        }
      }
    };

    const initialFetch = async () => {
      try {
        const response = await fetch('/api/world/status');
        const data = await response.json();
        if (data.success && data.data.agents) {
          const allAgents: AgentPublic[] = data.data.agents;

          if (!isSpectator) {
            const ourAgent = allAgents.find(a => a.id === selectedAgentId);
            if (ourAgent) {
              targetPosRef.current.x = ourAgent.x;
              targetPosRef.current.y = ourAgent.y;
              setDisplayPos({ x: ourAgent.x, y: ourAgent.y });
              const tiles = await fetchTiles(ourAgent.x, ourAgent.y);
              buildTerrain(tiles, ourAgent.x, ourAgent.y);
            }
          }

          const agentGroup = agentGroupRef.current;
          if (agentGroup) {
            const center = getCenter();
            allAgents.forEach(agent => {
              if (!isSpectator && agent.id === selectedAgentId) return;
              const relX = agent.x - center.x;
              const relZ = agent.y - center.y;
              if (Math.abs(relX) <= VIEW_RADIUS && Math.abs(relZ) <= VIEW_RADIUS) {
                const mesh = createCrabMesh(COLORS.agentOther);
                mesh.position.set(relX, 0, relZ);
                agentGroup.add(mesh);
                otherAgentsRef.current.set(agent.id, {
                  worldX: agent.x,
                  worldY: agent.y,
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

    initialFetch();

    const channelName = isSpectator
      ? 'spectator-fpv-' + Math.random().toString(36).slice(2, 8)
      : 'agent-fpv-' + selectedAgentId;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agents_realtime' },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            handleAgentUpdate(payload as unknown as { new: { id: string; x: number; y: number; name: string } });
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [selectedAgentId, isSpectator, fetchTiles, buildTerrain, createCrabMesh]);

  // ─── Joystick handlers ────────────────────────────────────────────────────────

  const handleJoystickTouch = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = joystickPadRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const padCenterX = rect.width / 2;
    const padCenterY = rect.height / 2;
    const touch = e.touches[0];
    const dx = touch.clientX - rect.left - padCenterX;
    const dy = touch.clientY - rect.top - padCenterY;
    const maxDist = rect.width / 2;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDist);
    const angle = Math.atan2(dy, dx);
    const normX = (dist / maxDist) * Math.cos(angle);
    const normY = (dist / maxDist) * Math.sin(angle);
    setJoystickPos({ x: normX * maxDist * 0.6, y: normY * maxDist * 0.6 });
    joystickInputRef.current = { x: normX, y: normY };
    setJoystickActive(true);
  }, []);

  const handleJoystickEnd = useCallback(() => {
    setJoystickPos({ x: 0, y: 0 });
    joystickInputRef.current = { x: 0, y: 0 };
    setJoystickActive(false);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-lg overflow-hidden">
      {/* HUD - info panel top-left */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none">
        <div className="pointer-events-auto bg-black/70 backdrop-blur-sm rounded-lg px-4 py-3" data-spectator-ui>
          {isSpectator ? (
            <>
              <div className="text-white font-bold text-sm">Spectator</div>
              <div className="text-white/70 text-xs mt-0.5">({displayPos.x}, {displayPos.y})</div>
              <div className="text-blue-400 text-xs mt-1 flex items-center gap-1">
                <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                Free roam
              </div>
              <div className="text-white/70 text-xs mt-1">Terrain: {currentTerrain.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}</div>
            </>
          ) : (
            <>
              <div className="text-white font-bold text-sm">{agentName || 'Agent'}</div>
              <div className="text-white/70 text-xs mt-0.5">({displayPos.x}, {displayPos.y})</div>
              <div className="text-green-400 text-xs mt-1 flex items-center gap-1">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Live
              </div>
              <div className="text-white/70 text-xs mt-1">Terrain: {currentTerrain.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}</div>
            </>
          )}
        </div>
      </div>

      {/* Close button - top right, compact */}
      {onClose && (
        <div className="absolute top-3 right-3 z-10">
          <button
            onClick={onClose}
            className="pointer-events-auto w-8 h-8 bg-black/60 backdrop-blur-sm hover:bg-black/80 rounded-full text-white/80 hover:text-white text-sm font-bold transition-colors flex items-center justify-center"
            data-spectator-ui
          >
            ✕
          </button>
        </div>
      )}

      {/* Controls hint (spectator mode, desktop) */}
      {isSpectator && (
        <div className="absolute top-16 left-3 z-10 pointer-events-none hidden md:block" data-spectator-ui>
          <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-white/60 space-y-0.5">
            <div className="text-white/80 font-semibold mb-1">Controls</div>
            <div><span className="text-white/90 font-mono">W A S D</span> Move</div>
            <div><span className="text-white/90 font-mono">← →</span> Rotate</div>
            <div><span className="text-white/90 font-mono">Drag</span> Look around</div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
          <div className="text-white text-center">
            <div className="text-3xl mb-2">{isSpectator ? '👁️' : '🦀'}</div>
            <span>{isSpectator ? 'Entering spectator mode...' : 'Entering world...'}</span>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div ref={containerRef} className={`w-full h-full ${isSpectator ? 'cursor-grab active:cursor-grabbing' : ''}`} />

      {/* Bottom left - Mode label */}
      <div className="absolute bottom-3 left-3 z-10 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-white/70">
        {isSpectator ? 'Free exploration' : "Agent\u0027s eye view"}
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

      {/* Bottom center - Crab indicator (follow mode only) */}
      {!isSpectator && (
        <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 translate-y-1/4 z-10 pointer-events-none">
          <CrabSprite animation="idle" scale={2.5} />
        </div>
      )}

      {/* Virtual Joystick (spectator mode, mobile/touch) */}
      {isSpectator && (
        <div
          ref={joystickPadRef}
          className="absolute bottom-20 left-4 z-20 w-24 h-24 md:hidden rounded-full bg-white/10 border-2 border-white/30 touch-none select-none"
          data-spectator-ui
          onTouchStart={handleJoystickTouch}
          onTouchMove={handleJoystickTouch}
          onTouchEnd={handleJoystickEnd}
          onTouchCancel={handleJoystickEnd}
        >
          <div
            className={`absolute w-10 h-10 rounded-full bg-white/40 pointer-events-none ${joystickActive ? '' : 'transition-transform duration-150'}`}
            style={{
              left: '50%',
              top: '50%',
              transform: `translate(calc(-50% + ${joystickPos.x}px), calc(-50% + ${joystickPos.y}px))`,
            }}
          />
        </div>
      )}

      {/* Mobile rotate buttons (spectator mode) - right above minimap */}
      {isSpectator && (
        <div className="absolute right-3 z-20 md:hidden flex gap-2" data-spectator-ui style={{ bottom: `${MINIMAP_SIZE + 24}px` }}>
          <button
            className="w-10 h-10 rounded-full bg-black/50 border border-white/25 flex items-center justify-center text-white/60 text-lg active:bg-white/20 select-none touch-none"
            onTouchStart={() => { mobileRotateRef.current = 1; }}
            onTouchEnd={() => { mobileRotateRef.current = 0; }}
            onTouchCancel={() => { mobileRotateRef.current = 0; }}
          >
            &#x21B6;
          </button>
          <button
            className="w-10 h-10 rounded-full bg-black/50 border border-white/25 flex items-center justify-center text-white/60 text-lg active:bg-white/20 select-none touch-none"
            onTouchStart={() => { mobileRotateRef.current = -1; }}
            onTouchEnd={() => { mobileRotateRef.current = 0; }}
            onTouchCancel={() => { mobileRotateRef.current = 0; }}
          >
            &#x21B7;
          </button>
        </div>
      )}
    </div>
  );
}
