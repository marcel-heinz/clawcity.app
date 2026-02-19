'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  getRenderLabAssetPack,
  PrototypeBuildingType,
  RenderLabAssetPack,
  RenderLabAssetPackId,
  RENDER_LAB_PROTOTYPE_BUILDINGS,
} from '@/lib/render-lab/asset-packs';
import { Tile, TerrainType } from '@/lib/types';

export type RenderLabCameraPreset = 'cinematic' | 'isometric' | 'tactical' | 'topdown';

export interface RenderLabVisualControls {
  featureDensity: number;
  prototypeDensity: number;
  jitter: number;
  assetScale: number;
  showGrid: boolean;
  showPrototypeBuildings: boolean;
  showRoads: boolean;
  showSettlements: boolean;
  showHorizonMountains: boolean;
  terrainRelief: number;
  mountainBoost: number;
  roadDensity: number;
  settlementDensity: number;
  renderDistance: number;
  ambientIntensity: number;
  sunIntensity: number;
  fogNear: number;
  fogFar: number;
  exposure: number;
}

export interface RenderLabPerfMetrics {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

interface RenderLabViewportProps {
  title: string;
  tiles: Tile[];
  centerX: number;
  centerY: number;
  packId: RenderLabAssetPackId;
  cameraPreset: RenderLabCameraPreset;
  controls: RenderLabVisualControls;
  onMetrics?: (metrics: RenderLabPerfMetrics) => void;
}

interface CameraPreset {
  distance: number;
  polar: number;
  azimuth: number;
  fov: number;
}

interface PatchInstance {
  x: number;
  y: number;
  z: number;
  sx: number;
  sz: number;
  rotationY?: number;
}

interface SettlementRoadLayout {
  roadKeys: Set<string>;
  settlementByKey: Map<string, PrototypeBuildingType>;
}

interface TerrainShapeControls {
  terrainRelief: number;
  mountainBoost: number;
}

interface LayoutControls {
  showRoads: boolean;
  showSettlements: boolean;
  roadDensity: number;
  settlementDensity: number;
}

const DEFAULT_FOG = { near: 30, far: 90 };
const DEFAULT_EXPOSURE = 1.1;
const DEFAULT_AMBIENT = 0.45;
const DEFAULT_SUN = 1.2;
const CHUNK_SIZE = 12;

const RESIDENTIAL_PROTOTYPES: PrototypeBuildingType[] = ['cottage', 'townhouse', 'barn', 'hall'];
const INDUSTRIAL_PROTOTYPES: PrototypeBuildingType[] = ['watchtower', 'windmill', 'greenhouse', 'foundry'];

const CAMERA_PRESETS: Record<RenderLabCameraPreset, CameraPreset> = {
  cinematic: { distance: 18, polar: 1.08, azimuth: 0.4, fov: 60 },
  isometric: { distance: 22, polar: 0.94, azimuth: Math.PI / 4, fov: 50 },
  tactical: { distance: 30, polar: 0.78, azimuth: 0.6, fov: 44 },
  topdown: { distance: 38, polar: 0.22, azimuth: 0.1, fov: 40 },
};

const CAMERA_LIMITS = {
  distanceMin: 6,
  distanceMax: 140,
  polarMin: 0.12,
  polarMax: 1.45,
};

const CARDINAL_DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const NEIGHBOR_DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function seeded(seed: number, salt: number): number {
  const x = Math.sin((seed + salt) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function tileSeed(x: number, y: number): number {
  return x * 92821 + y * 68917;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function parseTileKey(key: string): [number, number] {
  const [x, y] = key.split(',').map(Number);
  return [x, y];
}

function isRoadTerrain(terrain: TerrainType): boolean {
  return terrain !== 'water' && terrain !== 'deep_water';
}

function isSettlementTerrain(terrain: TerrainType): boolean {
  return terrain === 'plains' || terrain === 'forest' || terrain === 'sand' || terrain === 'rocky' || terrain === 'market';
}

function featureDensityApplies(terrain: TerrainType): boolean {
  return terrain !== 'water' && terrain !== 'deep_water' && terrain !== 'market' && terrain !== 'plains';
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;

    node.geometry.dispose();

    if (Array.isArray(node.material)) {
      node.material.forEach((material) => material.dispose());
      return;
    }

    node.material.dispose();
  });
}

function pickPrototypeType(tile: Tile, seed: number, density: number): PrototypeBuildingType | null {
  if (!['plains', 'forest', 'sand', 'rocky', 'market'].includes(tile.terrain)) {
    return null;
  }

  const terrainFactor = tile.terrain === 'market' ? 0.6 : tile.terrain === 'rocky' ? 0.76 : 1;
  if (seeded(seed, 7001) > density * terrainFactor) {
    return null;
  }

  const pool = tile.terrain === 'market' || tile.terrain === 'rocky'
    ? INDUSTRIAL_PROTOTYPES
    : RESIDENTIAL_PROTOTYPES;
  const index = Math.floor(seeded(seed, 7002) * pool.length);
  return pool[index] ?? pool[0] ?? RENDER_LAB_PROTOTYPE_BUILDINGS[0] ?? null;
}

function computeTileHeight(
  tile: Tile,
  tileByKey: Map<string, Tile>,
  activePack: RenderLabAssetPack,
  controls: TerrainShapeControls
): number {
  const profile = activePack.terrainProfile;
  const seed = tileSeed(tile.x, tile.y);
  const base = profile.baseHeight[tile.terrain];

  const macro = (seeded(seed, 8101) - 0.5) * profile.macroNoise;
  const micro = (seeded(seed, 8102) - 0.5) * profile.microNoise;
  let height = base + macro + micro;

  let neighborRelief = 0;
  for (const [dx, dy] of NEIGHBOR_DIRECTIONS) {
    const neighbor = tileByKey.get(tileKey(tile.x + dx, tile.y + dy));
    if (!neighbor) continue;
    if (neighbor.terrain === 'mountain') {
      neighborRelief += 1;
    } else if (neighbor.terrain === 'rocky') {
      neighborRelief += 0.55;
    }
  }

  height += neighborRelief * 0.06 * controls.mountainBoost;

  if (tile.terrain === 'mountain' || tile.terrain === 'rocky') {
    const ridge = Math.max(0, seeded(seed, 8103) - 0.24) * profile.ridgeNoise;
    height += ridge * (tile.terrain === 'mountain' ? 1.15 : 0.72) * controls.mountainBoost;
  }

  if (tile.terrain === 'deep_water' || tile.terrain === 'water' || tile.terrain === 'marsh') {
    const terrainOffset = tile.terrain === 'deep_water'
      ? -0.18
      : tile.terrain === 'marsh'
        ? 0.08
        : 0;
    height = Math.min(height, profile.waterLevel + terrainOffset);
  }

  return height * controls.terrainRelief;
}

function buildHeightMap(
  tiles: Tile[],
  tileByKey: Map<string, Tile>,
  activePack: RenderLabAssetPack,
  controls: TerrainShapeControls
): Map<string, number> {
  let current = new Map<string, number>();

  for (const tile of tiles) {
    current.set(
      tileKey(tile.x, tile.y),
      computeTileHeight(tile, tileByKey, activePack, controls)
    );
  }

  for (let pass = 0; pass < 2; pass++) {
    const next = new Map<string, number>(current);

    for (const tile of tiles) {
      const key = tileKey(tile.x, tile.y);
      const own = current.get(key) ?? 0;

      let sum = own;
      let count = 1;

      for (const [dx, dy] of NEIGHBOR_DIRECTIONS) {
        const neighborHeight = current.get(tileKey(tile.x + dx, tile.y + dy));
        if (neighborHeight === undefined) continue;
        sum += neighborHeight;
        count += 1;
      }

      const avg = sum / count;
      const blend = tile.terrain === 'mountain'
        ? 0.2
        : tile.terrain === 'deep_water' || tile.terrain === 'water'
          ? 0.42
          : 0.32;

      let smoothed = THREE.MathUtils.lerp(own, avg, blend);
      if (tile.terrain === 'mountain') {
        smoothed = Math.max(smoothed, own * 0.9);
      }
      if (tile.terrain === 'deep_water') {
        smoothed = Math.min(smoothed, own * 0.92);
      }

      next.set(key, smoothed);
    }

    current = next;
  }

  return current;
}

function sampleCornerHeight(cornerX: number, cornerY: number, heightByKey: Map<string, number>): number {
  const x0 = Math.floor(cornerX);
  const x1 = x0 + 1;
  const y0 = Math.floor(cornerY);
  const y1 = y0 + 1;

  const keys = [
    tileKey(x0, y0),
    tileKey(x1, y0),
    tileKey(x0, y1),
    tileKey(x1, y1),
  ];

  let sum = 0;
  let count = 0;

  for (const key of keys) {
    const value = heightByKey.get(key);
    if (value === undefined) continue;
    sum += value;
    count += 1;
  }

  if (count === 0) return 0;
  return sum / count;
}

function sampleCornerColor(
  cornerX: number,
  cornerY: number,
  tileByKey: Map<string, Tile>,
  activePack: RenderLabAssetPack
): THREE.Color {
  const x0 = Math.floor(cornerX);
  const x1 = x0 + 1;
  const y0 = Math.floor(cornerY);
  const y1 = y0 + 1;

  const coords: Array<[number, number]> = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ];

  const result = new THREE.Color(0, 0, 0);
  const color = new THREE.Color();
  let count = 0;

  for (const [x, y] of coords) {
    const tile = tileByKey.get(tileKey(x, y));
    if (!tile) continue;

    color.setHex(activePack.groundColor(tile.terrain, tileSeed(tile.x, tile.y)));
    result.r += color.r;
    result.g += color.g;
    result.b += color.b;
    count += 1;
  }

  if (count === 0) {
    return new THREE.Color(0x55724a);
  }

  result.multiplyScalar(1 / count);
  return result;
}

function createFarFeature(terrain: TerrainType, seed: number): THREE.Object3D | null {
  if (terrain === 'forest') {
    const group = new THREE.Group();

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.05, 0.42, 5),
      new THREE.MeshStandardMaterial({ color: 0x5c3922, roughness: 0.94 })
    );
    trunk.position.y = 0.2;
    trunk.castShadow = true;
    group.add(trunk);

    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(0.2 + seeded(seed, 9011) * 0.08, 0.52, 6),
      new THREE.MeshStandardMaterial({ color: 0x2f7432, roughness: 0.86, flatShading: true })
    );
    canopy.position.y = 0.54;
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    group.add(canopy);

    return group;
  }

  if (terrain === 'mountain' || terrain === 'rocky') {
    const peak = new THREE.Mesh(
      new THREE.ConeGeometry(0.3 + seeded(seed, 9012) * 0.2, 0.92 + seeded(seed, 9013) * 0.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x676f79, roughness: 0.92, flatShading: true })
    );
    peak.position.y = peak.geometry.parameters.height * 0.5;
    peak.castShadow = true;
    peak.receiveShadow = true;
    return peak;
  }

  return null;
}

function connectRoadPath(
  from: [number, number],
  to: [number, number],
  seed: number,
  tileByKey: Map<string, Tile>,
  roadKeys: Set<string>
): void {
  let [x, y] = from;
  const [tx, ty] = to;
  let horizontalFirst = seeded(seed, 9301) < 0.5;

  let guard = 0;
  while ((x !== tx || y !== ty) && guard < 800) {
    if (horizontalFirst) {
      if (x !== tx) x += x < tx ? 1 : -1;
      else if (y !== ty) y += y < ty ? 1 : -1;
    } else {
      if (y !== ty) y += y < ty ? 1 : -1;
      else if (x !== tx) x += x < tx ? 1 : -1;
    }

    const key = tileKey(x, y);
    const tile = tileByKey.get(key);
    if (tile && isRoadTerrain(tile.terrain)) {
      roadKeys.add(key);
    }

    if (guard % 3 === 0) {
      horizontalFirst = !horizontalFirst;
    }

    guard += 1;
  }
}

function generateRoadAndSettlements(
  tiles: Tile[],
  tileByKey: Map<string, Tile>,
  controls: LayoutControls
): SettlementRoadLayout {
  const roadKeys = new Set<string>();
  const settlementByKey = new Map<string, PrototypeBuildingType>();

  const hubs: Array<[number, number]> = [];
  for (const tile of tiles) {
    const key = tileKey(tile.x, tile.y);
    if (tile.terrain === 'market' || Boolean(tile.building_type)) {
      hubs.push([tile.x, tile.y]);
      roadKeys.add(key);
    }
  }

  if (controls.showSettlements) {
    for (const tile of tiles) {
      if (tile.building_type || !isSettlementTerrain(tile.terrain)) continue;

      const seed = tileSeed(tile.x, tile.y);
      const terrainBias = tile.terrain === 'plains'
        ? 1
        : tile.terrain === 'forest'
          ? 0.82
          : tile.terrain === 'sand'
            ? 0.56
            : tile.terrain === 'market'
              ? 0.64
              : 0.42;

      let nearWaterBonus = 0;
      for (const [dx, dy] of CARDINAL_DIRECTIONS) {
        const neighbor = tileByKey.get(tileKey(tile.x + dx, tile.y + dy));
        if (!neighbor) continue;
        if (neighbor.terrain === 'water' || neighbor.terrain === 'deep_water') {
          nearWaterBonus = 0.08;
          break;
        }
      }

      const chance = controls.settlementDensity * terrainBias + nearWaterBonus;
      if (seeded(seed, 9201) > chance) continue;

      const index = Math.floor(seeded(seed, 9202) * RESIDENTIAL_PROTOTYPES.length);
      const prototype = RESIDENTIAL_PROTOTYPES[index] ?? 'cottage';

      const key = tileKey(tile.x, tile.y);
      settlementByKey.set(key, prototype);

      if (seeded(seed, 9203) < 0.35) {
        roadKeys.add(key);
      }
    }
  }

  const mutableHubs = [...hubs];
  if (mutableHubs.length === 0) {
    const fallback = tiles.find((tile) => isSettlementTerrain(tile.terrain));
    if (fallback) {
      mutableHubs.push([fallback.x, fallback.y]);
    }
  }

  if (controls.showRoads || controls.showSettlements) {
    for (const key of settlementByKey.keys()) {
      const [sx, sy] = parseTileKey(key);
      const seed = tileSeed(sx, sy);

      if (seeded(seed, 9204) > controls.roadDensity + 0.08) {
        continue;
      }

      let nearest: [number, number] | null = null;
      let nearestDist = Number.POSITIVE_INFINITY;

      for (const [hx, hy] of mutableHubs) {
        const dist = Math.abs(hx - sx) + Math.abs(hy - sy);
        if (dist === 0 || dist > 72) continue;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = [hx, hy];
        }
      }

      if (!nearest) continue;

      connectRoadPath([sx, sy], nearest, seed, tileByKey, roadKeys);
      mutableHubs.push([sx, sy]);
    }

    for (const [hx, hy] of mutableHubs) {
      const seed = tileSeed(hx, hy);
      if (seeded(seed, 9205) > controls.roadDensity) continue;

      CARDINAL_DIRECTIONS.forEach(([dx, dy], directionIndex) => {
        if (seeded(seed, 9210 + directionIndex) > controls.roadDensity * 0.9) {
          return;
        }

        for (let step = 1; step <= 2; step++) {
          const tx = hx + dx * step;
          const ty = hy + dy * step;
          const tile = tileByKey.get(tileKey(tx, ty));
          if (!tile || !isRoadTerrain(tile.terrain)) break;
          roadKeys.add(tileKey(tx, ty));
        }
      });
    }
  }

  return { roadKeys, settlementByKey };
}

function createGroundPatchMesh(
  patches: PatchInstance[],
  color: number,
  roughness: number,
  metalness: number,
  opacity = 1
): THREE.InstancedMesh | null {
  if (patches.length === 0) return null;

  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    transparent: opacity < 1,
    opacity,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, patches.length);
  const baseQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const yawQuat = new THREE.Quaternion();
  const rotationQuat = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  const yAxis = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i]!;
    position.set(patch.x, patch.y, patch.z);
    scale.set(patch.sx, patch.sz, 1);

    if (patch.rotationY) {
      yawQuat.setFromAxisAngle(yAxis, patch.rotationY);
      rotationQuat.copy(baseQuat).multiply(yawQuat);
    } else {
      rotationQuat.copy(baseQuat);
    }

    matrix.compose(position, rotationQuat, scale);
    mesh.setMatrixAt(i, matrix);
  }

  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createHorizonMountains(activePack: RenderLabAssetPack, radius: number): THREE.Object3D {
  const count = 28;
  const geometry = new THREE.ConeGeometry(2.8, 9, 7);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(activePack.groundColor('mountain', 3333)).multiplyScalar(0.92),
    roughness: 0.94,
    flatShading: true,
  });

  const instanced = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const t = i / count;
    const angle = t * Math.PI * 2;
    const localRadius = radius + 8 + seeded(i * 187, 7003) * 10;
    const peakHeightScale = 0.6 + seeded(i * 187, 7004) * 1.3;
    const peakWidthScale = 0.5 + seeded(i * 187, 7005) * 0.9;

    position.set(Math.cos(angle) * localRadius, -1.2, Math.sin(angle) * localRadius);
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle + seeded(i * 187, 7006) * 0.45);
    scale.set(peakWidthScale, peakHeightScale, peakWidthScale);

    matrix.compose(position, quaternion, scale);
    instanced.setMatrixAt(i, matrix);
  }

  instanced.instanceMatrix.needsUpdate = true;
  instanced.castShadow = true;
  instanced.receiveShadow = true;

  return instanced;
}

export function RenderLabViewport({
  title,
  tiles,
  centerX,
  centerY,
  packId,
  cameraPreset,
  controls,
  onMetrics,
}: RenderLabViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const terrainRootRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const sunRef = useRef<THREE.DirectionalLight | null>(null);
  const ambientRef = useRef<THREE.AmbientLight | null>(null);
  const waterMeshesRef = useRef<THREE.Mesh[]>([]);
  const chunkGroupsRef = useRef<THREE.Group[]>([]);
  const horizonRef = useRef<THREE.Object3D | null>(null);

  const dragStateRef = useRef<{ dragging: boolean; x: number; y: number }>({
    dragging: false,
    x: 0,
    y: 0,
  });

  const keyStateRef = useRef<Record<string, boolean>>({});

  const cameraStateRef = useRef<{
    targetX: number;
    targetZ: number;
    distance: number;
    polar: number;
    azimuth: number;
  }>({
    targetX: 0,
    targetZ: 0,
    distance: CAMERA_PRESETS[cameraPreset].distance,
    polar: CAMERA_PRESETS[cameraPreset].polar,
    azimuth: CAMERA_PRESETS[cameraPreset].azimuth,
  });

  const perfRef = useRef<{
    frameCount: number;
    elapsedMs: number;
    lastSampleMs: number;
  }>({ frameCount: 0, elapsedMs: 0, lastSampleMs: 0 });

  const cullingRef = useRef<{ lastUpdateMs: number }>({ lastUpdateMs: 0 });
  const controlsRef = useRef(controls);
  const onMetricsRef = useRef(onMetrics);

  const activePack = useMemo(() => getRenderLabAssetPack(packId), [packId]);

  useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  useEffect(() => {
    onMetricsRef.current = onMetrics;
  }, [onMetrics]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x86b5dd);
    scene.fog = new THREE.Fog(0x86b5dd, DEFAULT_FOG.near, DEFAULT_FOG.far);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(CAMERA_PRESETS.isometric.fov, 1, 0.1, 350);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = DEFAULT_EXPOSURE;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x8ea6cc, DEFAULT_AMBIENT);
    ambientRef.current = ambient;
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff2de, DEFAULT_SUN);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 140;
    sun.shadow.camera.left = -48;
    sun.shadow.camera.right = 48;
    sun.shadow.camera.top = 48;
    sun.shadow.camera.bottom = -48;
    sun.position.set(20, 28, 14);
    sunRef.current = sun;
    scene.add(sun);
    scene.add(sun.target);

    const hemi = new THREE.HemisphereLight(0x9ec9ef, 0x4f5b35, 0.35);
    scene.add(hemi);

    const root = new THREE.Group();
    root.name = 'render-lab-terrain';
    terrainRootRef.current = root;
    scene.add(root);

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const preset = CAMERA_PRESETS.isometric;
    camera.fov = preset.fov;
    camera.updateProjectionMatrix();
    cameraStateRef.current.distance = preset.distance;
    cameraStateRef.current.azimuth = preset.azimuth;
    cameraStateRef.current.polar = preset.polar;

    let animationId = 0;
    let lastFrameTime = performance.now();
    let elapsed = 0;

    const animate = () => {
      animationId = window.requestAnimationFrame(animate);

      const now = performance.now();
      const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
      lastFrameTime = now;
      elapsed += dt;

      const cam = cameraStateRef.current;
      const moveSpeed = 12;
      if (keyStateRef.current.w || keyStateRef.current.arrowup) cam.targetZ -= moveSpeed * dt;
      if (keyStateRef.current.s || keyStateRef.current.arrowdown) cam.targetZ += moveSpeed * dt;
      if (keyStateRef.current.a || keyStateRef.current.arrowleft) cam.targetX -= moveSpeed * dt;
      if (keyStateRef.current.d || keyStateRef.current.arrowright) cam.targetX += moveSpeed * dt;

      const spherical = new THREE.Spherical(cam.distance, cam.polar, cam.azimuth);
      const offset = new THREE.Vector3().setFromSpherical(spherical);
      camera.position.set(cam.targetX + offset.x, Math.max(2, offset.y), cam.targetZ + offset.z);
      camera.lookAt(cam.targetX, 0, cam.targetZ);

      if (sunRef.current) {
        sunRef.current.position.set(cam.targetX + 20, 28, cam.targetZ + 14);
        sunRef.current.target.position.set(cam.targetX, 0, cam.targetZ);
      }

      if (horizonRef.current) {
        horizonRef.current.position.set(cam.targetX, 0, cam.targetZ);
      }

      if (now - cullingRef.current.lastUpdateMs >= 180) {
        const maxDistance = controlsRef.current.renderDistance;
        for (const chunk of chunkGroupsRef.current) {
          const chunkX = Number(chunk.userData.chunkCenterX ?? 0);
          const chunkZ = Number(chunk.userData.chunkCenterZ ?? 0);
          const chunkRadius = Number(chunk.userData.chunkRadius ?? 0);
          const dx = chunkX - cam.targetX;
          const dz = chunkZ - cam.targetZ;
          const allowed = maxDistance + chunkRadius;
          chunk.visible = dx * dx + dz * dz <= allowed * allowed;
        }
        cullingRef.current.lastUpdateMs = now;
      }

      waterMeshesRef.current.forEach((mesh, idx) => {
        const baseY = Number(mesh.userData.waterBaseY ?? -0.05);
        const wave = Math.sin(elapsed * 1.6 + idx * 0.17 + mesh.position.x * 0.6) * 0.014;
        mesh.position.y = baseY + wave;
      });

      renderer.render(scene, camera);

      perfRef.current.frameCount += 1;
      perfRef.current.elapsedMs += dt * 1000;
      if (onMetricsRef.current && now - perfRef.current.lastSampleMs >= 700) {
        const fps = perfRef.current.elapsedMs > 0
          ? (perfRef.current.frameCount * 1000) / perfRef.current.elapsedMs
          : 0;
        const frameMs = fps > 0 ? 1000 / fps : 0;

        onMetricsRef.current({
          fps,
          frameMs,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
        });

        perfRef.current.frameCount = 0;
        perfRef.current.elapsedMs = 0;
        perfRef.current.lastSampleMs = now;
      }
    };

    animate();

    const handleKeyDown = (event: KeyboardEvent) => {
      keyStateRef.current[event.key.toLowerCase()] = true;
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      keyStateRef.current[event.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const handlePointerDown = (event: PointerEvent) => {
      dragStateRef.current.dragging = true;
      dragStateRef.current.x = event.clientX;
      dragStateRef.current.y = event.clientY;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current.dragging) return;

      const dx = event.clientX - dragStateRef.current.x;
      const dy = event.clientY - dragStateRef.current.y;
      dragStateRef.current.x = event.clientX;
      dragStateRef.current.y = event.clientY;

      const cam = cameraStateRef.current;
      cam.azimuth -= dx * 0.006;
      cam.polar = clamp(cam.polar + dy * 0.006, CAMERA_LIMITS.polarMin, CAMERA_LIMITS.polarMax);
    };

    const handlePointerUp = () => {
      dragStateRef.current.dragging = false;
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const cam = cameraStateRef.current;
      cam.distance = clamp(cam.distance + event.deltaY * 0.015, CAMERA_LIMITS.distanceMin, CAMERA_LIMITS.distanceMax);
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('wheel', handleWheel);

      const rootGroup = terrainRootRef.current;
      if (rootGroup) {
        disposeObject3D(rootGroup);
        scene.remove(rootGroup);
      }

      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }

      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      terrainRootRef.current = null;
      waterMeshesRef.current = [];
      chunkGroupsRef.current = [];
      horizonRef.current = null;
      gridRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (controls.showGrid) {
      if (!gridRef.current) {
        const grid = new THREE.GridHelper(260, 260, 0x6f7a88, 0x5a6674);
        grid.position.y = -0.015;
        grid.material.opacity = 0.2;
        grid.material.transparent = true;
        gridRef.current = grid;
        scene.add(grid);
      }
      return;
    }

    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current.geometry.dispose();
      if (Array.isArray(gridRef.current.material)) {
        gridRef.current.material.forEach((material) => material.dispose());
      } else {
        gridRef.current.material.dispose();
      }
      gridRef.current = null;
    }
  }, [controls.showGrid]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    scene.fog = new THREE.Fog(0x86b5dd, controls.fogNear, controls.fogFar);

    if (ambientRef.current) {
      ambientRef.current.intensity = controls.ambientIntensity;
    }

    if (sunRef.current) {
      sunRef.current.intensity = controls.sunIntensity;
    }

    if (rendererRef.current) {
      rendererRef.current.toneMappingExposure = controls.exposure;
    }
  }, [controls.ambientIntensity, controls.sunIntensity, controls.fogNear, controls.fogFar, controls.exposure]);

  useEffect(() => {
    const preset = CAMERA_PRESETS[cameraPreset];
    const cam = cameraStateRef.current;
    cam.distance = preset.distance;
    cam.polar = preset.polar;
    cam.azimuth = preset.azimuth;

    const camera = cameraRef.current;
    if (camera) {
      camera.fov = preset.fov;
      camera.updateProjectionMatrix();
    }
  }, [cameraPreset]);

  useEffect(() => {
    const root = terrainRootRef.current;
    if (!root) return;

    for (const child of root.children) {
      disposeObject3D(child);
    }
    root.clear();

    const loadedWaterMeshes: THREE.Mesh[] = [];
    const chunkGroups: THREE.Group[] = [];

    const tileByKey = new Map<string, Tile>();
    for (const tile of tiles) {
      tileByKey.set(tileKey(tile.x, tile.y), tile);
    }

    const heightByKey = buildHeightMap(tiles, tileByKey, activePack, {
      terrainRelief: controls.terrainRelief,
      mountainBoost: controls.mountainBoost,
    });
    const { roadKeys, settlementByKey } = generateRoadAndSettlements(tiles, tileByKey, {
      showRoads: controls.showRoads,
      showSettlements: controls.showSettlements,
      roadDensity: controls.roadDensity,
      settlementDensity: controls.settlementDensity,
    });

    const chunks = new Map<string, Tile[]>();
    for (const tile of tiles) {
      const chunkX = Math.floor(tile.x / CHUNK_SIZE);
      const chunkY = Math.floor(tile.y / CHUNK_SIZE);
      const key = `${chunkX},${chunkY}`;
      const chunkTiles = chunks.get(key);
      if (chunkTiles) {
        chunkTiles.push(tile);
      } else {
        chunks.set(key, [tile]);
      }
    }

    for (const chunkTiles of chunks.values()) {
      const chunkGroup = new THREE.Group();

      const positions: number[] = [];
      const colors: number[] = [];
      const indices: number[] = [];
      const vertexIndexByKey = new Map<string, number>();

      const addVertex = (cornerX: number, cornerY: number): number => {
        const key = `${cornerX},${cornerY}`;
        const existing = vertexIndexByKey.get(key);
        if (existing !== undefined) {
          return existing;
        }

        const localX = cornerX - centerX;
        const localZ = cornerY - centerY;
        const height = sampleCornerHeight(cornerX, cornerY, heightByKey);
        const color = sampleCornerColor(cornerX, cornerY, tileByKey, activePack);

        positions.push(localX, height, localZ);
        colors.push(color.r, color.g, color.b);

        const index = positions.length / 3 - 1;
        vertexIndexByKey.set(key, index);
        return index;
      };

      for (const tile of chunkTiles) {
        const nw = addVertex(tile.x - 0.5, tile.y - 0.5);
        const ne = addVertex(tile.x + 0.5, tile.y - 0.5);
        const sw = addVertex(tile.x - 0.5, tile.y + 0.5);
        const se = addVertex(tile.x + 0.5, tile.y + 0.5);

        indices.push(nw, sw, se, nw, se, ne);
      }

      const terrainGeometry = new THREE.BufferGeometry();
      terrainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      terrainGeometry.setIndex(indices);
      terrainGeometry.computeVertexNormals();

      const terrainMesh = new THREE.Mesh(
        terrainGeometry,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.94,
          metalness: 0.03,
        })
      );
      terrainMesh.receiveShadow = true;
      chunkGroup.add(terrainMesh);

      const ownerPatches: PatchInstance[] = [];
      const roadBasePatches: PatchInstance[] = [];
      const roadLinePatches: PatchInstance[] = [];
      const roadShoulderPatches: PatchInstance[] = [];

      let chunkXSum = 0;
      let chunkZSum = 0;

      for (const tile of chunkTiles) {
        const localX = tile.x - centerX;
        const localZ = tile.y - centerY;
        chunkXSum += localX;
        chunkZSum += localZ;

        const key = tileKey(tile.x, tile.y);
        const tileHeight = heightByKey.get(key) ?? 0;

        if (tile.owner_id) {
          ownerPatches.push({
            x: localX,
            y: tileHeight + 0.022,
            z: localZ,
            sx: 0.88,
            sz: 0.88,
          });
        }

        if (controls.showRoads && roadKeys.has(key) && isRoadTerrain(tile.terrain)) {
          const north = roadKeys.has(tileKey(tile.x, tile.y - 1));
          const south = roadKeys.has(tileKey(tile.x, tile.y + 1));
          const west = roadKeys.has(tileKey(tile.x - 1, tile.y));
          const east = roadKeys.has(tileKey(tile.x + 1, tile.y));

          const hasEW = east || west;
          const hasNS = north || south;
          const y = tileHeight + 0.028;

          if (hasEW || (!hasEW && !hasNS)) {
            roadShoulderPatches.push({ x: localX, y, z: localZ, sx: 1.02, sz: 0.42 });
            roadBasePatches.push({ x: localX, y: y + 0.002, z: localZ, sx: 0.98, sz: 0.34 });
            roadLinePatches.push({ x: localX, y: y + 0.004, z: localZ, sx: 0.9, sz: 0.05 });
          }

          if (hasNS) {
            roadShoulderPatches.push({ x: localX, y, z: localZ, sx: 0.42, sz: 1.02 });
            roadBasePatches.push({ x: localX, y: y + 0.002, z: localZ, sx: 0.34, sz: 0.98 });
            roadLinePatches.push({ x: localX, y: y + 0.004, z: localZ, sx: 0.05, sz: 0.9 });
          }

          if ((hasEW && hasNS) || (!hasEW && !hasNS)) {
            roadBasePatches.push({ x: localX, y: y + 0.003, z: localZ, sx: 0.34, sz: 0.34 });
          }
        }
      }

      const ownerMesh = createGroundPatchMesh(ownerPatches, 0x66ff7f, 0.48, 0.06, 0.14);
      if (ownerMesh) {
        chunkGroup.add(ownerMesh);
      }

      if (controls.showRoads) {
        const shoulderMesh = createGroundPatchMesh(
          roadShoulderPatches,
          activePack.roadStyle.shoulderColor,
          0.95,
          0.01
        );
        if (shoulderMesh) {
          chunkGroup.add(shoulderMesh);
        }

        const baseMesh = createGroundPatchMesh(
          roadBasePatches,
          activePack.roadStyle.baseColor,
          0.91,
          0.02
        );
        if (baseMesh) {
          chunkGroup.add(baseMesh);
        }

        const lineMesh = createGroundPatchMesh(
          roadLinePatches,
          activePack.roadStyle.lineColor,
          0.78,
          0.03
        );
        if (lineMesh) {
          chunkGroup.add(lineMesh);
        }
      }

      const detailFalloff = controls.renderDistance * 0.72;
      for (const tile of chunkTiles) {
        const seed = tileSeed(tile.x, tile.y);
        const key = tileKey(tile.x, tile.y);
        const tileHeight = heightByKey.get(key) ?? 0;
        const localX = tile.x - centerX;
        const localZ = tile.y - centerY;

        const radialDistance = Math.hypot(localX, localZ);
        const farTile = radialDistance > detailFalloff;

        let feature: THREE.Object3D | null = null;

        if (tile.building_type) {
          feature = activePack.createBuilding(tile.building_type, seed);
        } else if (controls.showSettlements && settlementByKey.has(key)) {
          const prototypeType = settlementByKey.get(key) ?? 'cottage';
          if (!farTile || seeded(seed, 9501) < 0.4) {
            feature = activePack.createPrototypeBuilding(prototypeType, seed);
          }
        } else if (controls.showPrototypeBuildings && !farTile) {
          const prototype = pickPrototypeType(tile, seed, controls.prototypeDensity);
          if (prototype) {
            feature = activePack.createPrototypeBuilding(prototype, seed);
          }
        }

        if (!feature) {
          const canShowFeature = !featureDensityApplies(tile.terrain)
            || seeded(seed, 1001) <= controls.featureDensity;

          if (canShowFeature) {
            if (farTile) {
              if (seeded(seed, 9502) <= 0.45) {
                feature = createFarFeature(tile.terrain, seed);
              }
            } else {
              feature = activePack.createTerrainFeature(tile.terrain, seed);
            }
          }
        }

        if (!feature) {
          continue;
        }

        const anchor = new THREE.Group();
        anchor.position.set(localX, tileHeight, localZ);

        const jx = (seeded(seed, 2001) - 0.5) * controls.jitter;
        const jz = (seeded(seed, 2002) - 0.5) * controls.jitter;

        feature.position.x += jx;
        feature.position.z += jz;
        feature.scale.multiplyScalar(controls.assetScale);

        feature.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          node.castShadow = true;
          node.receiveShadow = true;
          if (node.userData.isWater) {
            node.userData.waterBaseY = (node.position.y ?? 0);
            loadedWaterMeshes.push(node);
          }
        });

        anchor.add(feature);
        chunkGroup.add(anchor);
      }

      const chunkCount = chunkTiles.length;
      const centerLocalX = chunkCount > 0 ? chunkXSum / chunkCount : 0;
      const centerLocalZ = chunkCount > 0 ? chunkZSum / chunkCount : 0;

      let radius = 1;
      for (const tile of chunkTiles) {
        const dx = tile.x - centerX - centerLocalX;
        const dz = tile.y - centerY - centerLocalZ;
        radius = Math.max(radius, Math.hypot(dx, dz));
      }

      chunkGroup.userData.chunkCenterX = centerLocalX;
      chunkGroup.userData.chunkCenterZ = centerLocalZ;
      chunkGroup.userData.chunkRadius = radius + 1.5;

      chunkGroups.push(chunkGroup);
      root.add(chunkGroup);
    }

    if (controls.showHorizonMountains) {
      const horizon = createHorizonMountains(activePack, controls.renderDistance + 18);
      horizonRef.current = horizon;
      root.add(horizon);
    } else {
      horizonRef.current = null;
    }

    waterMeshesRef.current = loadedWaterMeshes;
    chunkGroupsRef.current = chunkGroups;

    cameraStateRef.current.targetX = 0;
    cameraStateRef.current.targetZ = 0;
    cullingRef.current.lastUpdateMs = 0;
  }, [
    tiles,
    centerX,
    centerY,
    activePack,
    controls.featureDensity,
    controls.prototypeDensity,
    controls.jitter,
    controls.assetScale,
    controls.showPrototypeBuildings,
    controls.showRoads,
    controls.showSettlements,
    controls.showHorizonMountains,
    controls.terrainRelief,
    controls.mountainBoost,
    controls.roadDensity,
    controls.settlementDensity,
    controls.renderDistance,
  ]);

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-black/30">
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
        <span className="font-semibold text-[var(--foreground)]">{title}</span>
        <span>{activePack.label}</span>
      </div>
      <div ref={containerRef} className="relative h-full min-h-[360px] w-full cursor-grab active:cursor-grabbing" />
      <div className="border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--muted)]">
        Drag to orbit • Wheel to zoom • WASD/Arrows to pan • Tiles rendered: {tiles.length.toLocaleString()}
      </div>
    </div>
  );
}
