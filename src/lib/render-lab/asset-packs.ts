import * as THREE from 'three';
import { TerrainType } from '@/lib/types';

export type RenderLabAssetPackId = 'current' | 'wildlands' | 'citadel' | 'frontier';
export type PrototypeBuildingType =
  | 'watchtower'
  | 'windmill'
  | 'greenhouse'
  | 'foundry'
  | 'cottage'
  | 'townhouse'
  | 'barn'
  | 'hall';

export interface RenderLabTerrainProfile {
  baseHeight: Record<TerrainType, number>;
  macroNoise: number;
  microNoise: number;
  ridgeNoise: number;
  waterLevel: number;
}

export interface RenderLabRoadStyle {
  baseColor: number;
  lineColor: number;
  shoulderColor: number;
}

export interface RenderLabAssetPack {
  id: RenderLabAssetPackId;
  label: string;
  description: string;
  groundColor: (terrain: TerrainType, seed: number) => number;
  terrainProfile: RenderLabTerrainProfile;
  roadStyle: RenderLabRoadStyle;
  createTerrainFeature: (terrain: TerrainType, seed: number) => THREE.Object3D | null;
  createBuilding: (buildingType: string, seed: number) => THREE.Object3D | null;
  createPrototypeBuilding: (buildingType: PrototypeBuildingType, seed: number) => THREE.Object3D | null;
}

const BLOCK_SIZE = 1;

const BASE_GROUND_COLORS: Record<TerrainType, number> = {
  plains: 0x5a8f29,
  forest: 0x4a7f24,
  mountain: 0x6d7077,
  market: 0xc9a24b,
  water: 0x3f8fd3,
  rocky: 0x555a61,
  sand: 0xd2b372,
  deep_water: 0x223f6a,
  marsh: 0x4d7867,
};

function seeded(seed: number, salt: number): number {
  const x = Math.sin((seed + salt) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function tint(hex: number, delta: number): number {
  const color = new THREE.Color(hex);
  color.offsetHSL(0, 0, delta);
  return color.getHex();
}

function baseGroundColor(terrain: TerrainType, seed: number, variation = 0.05): number {
  const jitter = (seeded(seed, 17) - 0.5) * variation;
  return tint(BASE_GROUND_COLORS[terrain], jitter);
}

function createWaterPlane(color: number, y = -0.05, opacity = 0.8, roughness = 0.15, metalness = 0.25): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE),
    new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity,
      roughness,
      metalness,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true;
  mesh.userData.isWater = true;
  mesh.userData.waterBaseY = y;
  return mesh;
}

function createCurrentTree(seed: number): THREE.Object3D {
  const group = new THREE.Group();
  const height = 1.1 + seeded(seed, 31) * 0.6;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.08, height * 0.35, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b3a1f, roughness: 0.9 })
  );
  trunk.position.y = (height * 0.35) * 0.5;
  trunk.castShadow = true;
  group.add(trunk);

  for (let i = 0; i < 3; i++) {
    const layerRadius = 0.46 - i * 0.1;
    const layerHeight = 0.42 - i * 0.08;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(layerRadius, layerHeight, 7),
      new THREE.MeshStandardMaterial({ color: [0x1e6b1e, 0x2d8a2d, 0x3da03d][i], roughness: 0.82, flatShading: true })
    );
    cone.position.y = height * 0.35 + i * 0.23 + 0.18;
    cone.castShadow = true;
    cone.receiveShadow = true;
    group.add(cone);
  }

  return group;
}

function createWildlandsTree(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.1, 0.62, 8),
    new THREE.MeshStandardMaterial({ color: 0x5f3c24, roughness: 0.9 })
  );
  trunk.position.y = 0.31;
  trunk.castShadow = true;
  group.add(trunk);

  const leafPalette = [0x225f2a, 0x2f8033, 0x3f9440];
  const crownCount = 4;
  for (let i = 0; i < crownCount; i++) {
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.23 + seeded(seed, 101 + i) * 0.08, 0),
      new THREE.MeshStandardMaterial({
        color: leafPalette[i % leafPalette.length],
        roughness: 0.75,
        flatShading: true,
      })
    );
    blob.position.set(
      (seeded(seed, 201 + i) - 0.5) * 0.24,
      0.72 + seeded(seed, 301 + i) * 0.25,
      (seeded(seed, 401 + i) - 0.5) * 0.24
    );
    blob.castShadow = true;
    blob.receiveShadow = true;
    group.add(blob);
  }

  return group;
}

function createCitadelTree(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.06, 0.5, 5),
    new THREE.MeshStandardMaterial({ color: 0x4f331e, roughness: 0.95, flatShading: true })
  );
  trunk.position.y = 0.25;
  trunk.castShadow = true;
  group.add(trunk);

  const needle = new THREE.Mesh(
    new THREE.ConeGeometry(0.28 + seeded(seed, 21) * 0.09, 0.95 + seeded(seed, 22) * 0.25, 5),
    new THREE.MeshStandardMaterial({ color: 0x355f35, roughness: 0.88, flatShading: true })
  );
  needle.position.y = 0.78;
  needle.castShadow = true;
  needle.receiveShadow = true;
  group.add(needle);

  return group;
}

function createCurrentMountain(seed: number): THREE.Object3D {
  const group = new THREE.Group();
  const height = 1.2 + seeded(seed, 51) * 0.7;
  const radius = 0.56 + seeded(seed, 52) * 0.18;

  const body = new THREE.Mesh(
    new THREE.ConeGeometry(radius, height, 6),
    new THREE.MeshStandardMaterial({ color: 0x6a6a70, roughness: 0.92, flatShading: true })
  );
  body.position.y = height * 0.5;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  if (height > 1.45) {
    const snow = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 0.22, height * 0.15, 6),
      new THREE.MeshStandardMaterial({ color: 0xe3eaef, roughness: 0.55 })
    );
    snow.position.y = height * 0.87;
    group.add(snow);
  }

  return group;
}

function createWildlandsMountain(seed: number): THREE.Object3D {
  const group = new THREE.Group();
  const peaks = 2 + Math.floor(seeded(seed, 61) * 2);

  for (let i = 0; i < peaks; i++) {
    const h = 0.95 + seeded(seed, 70 + i) * 0.7;
    const r = 0.35 + seeded(seed, 80 + i) * 0.22;
    const peak = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 7),
      new THREE.MeshStandardMaterial({ color: 0x6b7079, roughness: 0.9, flatShading: true })
    );
    peak.position.set((i - (peaks - 1) / 2) * 0.24, h * 0.48, (seeded(seed, 90 + i) - 0.5) * 0.2);
    peak.castShadow = true;
    peak.receiveShadow = true;
    group.add(peak);
  }

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.78, 0.16, 8),
    new THREE.MeshStandardMaterial({ color: 0x4d5258, roughness: 0.95, flatShading: true })
  );
  base.position.y = 0.08;
  base.receiveShadow = true;
  group.add(base);

  return group;
}

function createCitadelMountain(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.58 + seeded(seed, 66) * 0.16, 0),
    new THREE.MeshStandardMaterial({ color: 0x737984, roughness: 0.86, metalness: 0.08, flatShading: true })
  );
  core.position.y = 0.68;
  core.scale.y = 1.5;
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.8, 0.18, 6),
    new THREE.MeshStandardMaterial({ color: 0x5f6673, roughness: 0.93, flatShading: true })
  );
  skirt.position.y = 0.1;
  skirt.receiveShadow = true;
  group.add(skirt);

  return group;
}

function createCurrentRocky(seed: number): THREE.Object3D {
  const group = new THREE.Group();
  const count = 3 + Math.floor(seeded(seed, 101) * 3);
  for (let i = 0; i < count; i++) {
    const size = 0.08 + seeded(seed, 111 + i) * 0.18;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(size, 0),
      new THREE.MeshStandardMaterial({ color: [0x4a4a4a, 0x5a5a5a, 0x777777][i % 3], roughness: 0.96, flatShading: true })
    );
    const angle = seeded(seed, 121 + i) * Math.PI * 2;
    const dist = 0.08 + seeded(seed, 131 + i) * 0.28;
    rock.position.set(Math.cos(angle) * dist, size * 0.65, Math.sin(angle) * dist);
    rock.rotation.set(seeded(seed, 141 + i) * Math.PI, seeded(seed, 151 + i) * Math.PI, 0);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }
  return group;
}

function createCurrentSand(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const mound = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd6b56f, roughness: 0.97 })
  );
  mound.position.set((seeded(seed, 205) - 0.5) * 0.35, 0.01, (seeded(seed, 206) - 0.5) * 0.25);
  mound.scale.set(1.5, 0.42, 1);
  mound.receiveShadow = true;
  group.add(mound);

  return group;
}

function createCurrentMarsh(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const water = createWaterPlane(0x4c7768, 0.01, 0.74, 0.22, 0.08);
  water.userData.isWater = false;
  group.add(water);

  const reeds = 2 + Math.floor(seeded(seed, 301) * 3);
  for (let i = 0; i < reeds; i++) {
    const reed = new THREE.Group();

    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.018, 0.44, 5),
      new THREE.MeshStandardMaterial({ color: 0x556b2f, roughness: 0.84 })
    );
    stalk.position.y = 0.22;
    stalk.castShadow = true;
    reed.add(stalk);

    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.1, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.88 })
    );
    top.position.y = 0.42;
    reed.add(top);

    const angle = seeded(seed, 311 + i) * Math.PI * 2;
    const dist = 0.08 + seeded(seed, 321 + i) * 0.26;
    reed.position.set(Math.cos(angle) * dist, 0.01, Math.sin(angle) * dist);
    reed.rotation.z = (seeded(seed, 331 + i) - 0.5) * 0.12;
    group.add(reed);
  }

  return group;
}

function createCurrentMarket(): THREE.Object3D {
  const group = new THREE.Group();

  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.75, 0.65),
    new THREE.MeshStandardMaterial({ color: 0xf5deb3, roughness: 0.72 })
  );
  walls.position.y = 0.375;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.65, 0.4, 4),
    new THREE.MeshStandardMaterial({ color: 0xb84c3c, roughness: 0.64 })
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 0.95;
  roof.castShadow = true;
  group.add(roof);

  return group;
}

function createCurrentStorage(): THREE.Object3D {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.6, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xc4a06a, roughness: 0.78 })
  );
  body.position.y = 0.3;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.09, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.62 })
  );
  roof.position.y = 0.65;
  roof.castShadow = true;
  group.add(roof);

  return group;
}

function createCurrentWorkshop(): THREE.Object3D {
  const group = new THREE.Group();

  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.7, 0.65),
    new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.82 })
  );
  walls.position.y = 0.35;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.58, 0.34, 4),
    new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.7 })
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 0.88;
  roof.castShadow = true;
  group.add(roof);

  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xff6622, emissive: 0xff4400, emissiveIntensity: 0.5, roughness: 0.34 })
  );
  glow.position.set(0, 0.35, 0.34);
  group.add(glow);

  return group;
}

function createCurrentFortification(): THREE.Object3D {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.5, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x6a6a7a, roughness: 0.87, flatShading: true })
  );
  base.position.y = 0.25;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.14, 0.86, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a5a6a, roughness: 0.84, flatShading: true })
  );
  tower.position.set(0.35, 0.43, 0.35);
  tower.castShadow = true;
  group.add(tower);

  return group;
}

function createPrototypeWatchtower(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const legs = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.24, 0.9, 4),
    new THREE.MeshStandardMaterial({ color: 0x614024, roughness: 0.88, flatShading: true })
  );
  legs.position.y = 0.45;
  legs.castShadow = true;
  group.add(legs);

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.08, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x8a673f, roughness: 0.8 })
  );
  deck.position.y = 0.92;
  deck.castShadow = true;
  group.add(deck);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 0.28, 4),
    new THREE.MeshStandardMaterial({ color: 0x4b2f1a, roughness: 0.72 })
  );
  roof.rotation.y = (seeded(seed, 901) * Math.PI) / 2;
  roof.position.y = 1.14;
  roof.castShadow = true;
  group.add(roof);

  return group;
}

function createPrototypeWindmill(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.3, 0.95, 7),
    new THREE.MeshStandardMaterial({ color: 0xd7ceb2, roughness: 0.8 })
  );
  tower.position.y = 0.47;
  tower.castShadow = true;
  tower.receiveShadow = true;
  group.add(tower);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.25, 7),
    new THREE.MeshStandardMaterial({ color: 0x774d2e, roughness: 0.7 })
  );
  roof.position.y = 1.05;
  group.add(roof);

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.09, 6),
    new THREE.MeshStandardMaterial({ color: 0x4d3a2b, roughness: 0.78 })
  );
  hub.rotation.z = Math.PI / 2;
  hub.position.set(0, 0.78, 0.24);
  group.add(hub);

  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.34, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xe5dfca, roughness: 0.78 })
    );
    blade.position.set(0, Math.cos((Math.PI / 2) * i) * 0.16, 0.24 + Math.sin((Math.PI / 2) * i) * 0.16);
    blade.rotation.x = (Math.PI / 2) * i + seeded(seed, 911) * 0.2;
    group.add(blade);
  }

  return group;
}

function createPrototypeGreenhouse(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.82, 0.58, 0.66),
    new THREE.MeshStandardMaterial({ color: 0xb2b8bc, roughness: 0.68, metalness: 0.3 })
  );
  frame.position.y = 0.29;
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.76, 0.5, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x6abf9f, transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0.4 })
  );
  glass.position.y = 0.32;
  group.add(glass);

  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, 0.12, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x95a1a8, roughness: 0.6, metalness: 0.25 })
  );
  ridge.position.y = 0.62;
  ridge.rotation.x = (seeded(seed, 921) - 0.5) * 0.08;
  group.add(ridge);

  return group;
}

function createPrototypeFoundry(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.84, 0.5, 0.72),
    new THREE.MeshStandardMaterial({ color: 0x666d76, roughness: 0.85, flatShading: true })
  );
  base.position.y = 0.25;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const furnace = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, 0.58, 8),
    new THREE.MeshStandardMaterial({ color: 0x4d535b, roughness: 0.8 })
  );
  furnace.position.set(0.24, 0.52, 0);
  furnace.castShadow = true;
  group.add(furnace);

  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.14, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xff6a2a, emissive: 0xff3a00, emissiveIntensity: 0.62, roughness: 0.26 })
  );
  glow.position.set(-0.18, 0.23, 0.37);
  group.add(glow);

  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.4, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x3f454d, roughness: 0.9 })
  );
  chimney.position.set(-0.28, 0.7, -0.2);
  chimney.rotation.y = (seeded(seed, 931) - 0.5) * 0.25;
  chimney.castShadow = true;
  group.add(chimney);

  return group;
}

function createPrototypeCottage(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, 0.46, 0.66),
    new THREE.MeshStandardMaterial({ color: 0xcab18f, roughness: 0.84 })
  );
  walls.position.y = 0.23;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.58, 0.34, 4),
    new THREE.MeshStandardMaterial({ color: 0x7a4f2c, roughness: 0.72 })
  );
  roof.rotation.y = Math.PI / 4 + (seeded(seed, 941) - 0.5) * 0.18;
  roof.position.y = 0.63;
  roof.castShadow = true;
  group.add(roof);

  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.2, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x6d5f57, roughness: 0.9 })
  );
  chimney.position.set(0.22, 0.7, -0.1);
  chimney.castShadow = true;
  group.add(chimney);

  return group;
}

function createPrototypeTownhouse(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.68, 0.72, 0.58),
    new THREE.MeshStandardMaterial({ color: 0xb8bfc8, roughness: 0.76 })
  );
  body.position.y = 0.36;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.12, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x4a4f5d, roughness: 0.65 })
  );
  roof.position.y = 0.78;
  roof.rotation.y = (seeded(seed, 951) - 0.5) * 0.16;
  roof.castShadow = true;
  group.add(roof);

  const balcony = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.06, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x939ba8, roughness: 0.74 })
  );
  balcony.position.set(0, 0.47, 0.35);
  group.add(balcony);

  return group;
}

function createPrototypeBarn(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(0.88, 0.5, 0.66),
    new THREE.MeshStandardMaterial({ color: 0xa55a3a, roughness: 0.82 })
  );
  shell.position.y = 0.25;
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.64, 0.3, 4),
    new THREE.MeshStandardMaterial({ color: 0x5b2f1b, roughness: 0.74 })
  );
  roof.rotation.y = Math.PI / 4 + (seeded(seed, 961) - 0.5) * 0.18;
  roof.position.y = 0.65;
  roof.castShadow = true;
  group.add(roof);

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.3, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x412716, roughness: 0.92 })
  );
  door.position.set(0, 0.15, 0.35);
  group.add(door);

  return group;
}

function createPrototypeHall(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.52, 0.75),
    new THREE.MeshStandardMaterial({ color: 0x7b848f, roughness: 0.84, flatShading: true })
  );
  base.position.y = 0.26;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.66, 0.38, 6),
    new THREE.MeshStandardMaterial({ color: 0x4e5460, roughness: 0.72, flatShading: true })
  );
  roof.position.y = 0.73;
  roof.rotation.y = seeded(seed, 971) * 0.2;
  roof.castShadow = true;
  group.add(roof);

  const entry = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.2, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x939ba4, roughness: 0.76 })
  );
  entry.position.set(0, 0.12, 0.41);
  group.add(entry);

  return group;
}

function createPrototypeBuilding(buildingType: PrototypeBuildingType, seed: number): THREE.Object3D {
  switch (buildingType) {
    case 'watchtower':
      return createPrototypeWatchtower(seed);
    case 'windmill':
      return createPrototypeWindmill(seed);
    case 'greenhouse':
      return createPrototypeGreenhouse(seed);
    case 'foundry':
      return createPrototypeFoundry(seed);
    case 'cottage':
      return createPrototypeCottage(seed);
    case 'townhouse':
      return createPrototypeTownhouse(seed);
    case 'barn':
      return createPrototypeBarn(seed);
    case 'hall':
      return createPrototypeHall(seed);
    default:
      return createPrototypeWatchtower(seed);
  }
}

function buildPack(options: {
  id: RenderLabAssetPackId;
  label: string;
  description: string;
  createTree: (seed: number) => THREE.Object3D;
  createMountain: (seed: number) => THREE.Object3D;
  createStorage: (seed: number) => THREE.Object3D;
  createWorkshop: (seed: number) => THREE.Object3D;
  createFortification: (seed: number) => THREE.Object3D;
  dryWaterColor: number;
  deepWaterColor: number;
  marshColor: number;
  groundVariation: number;
  groundBias: number;
  terrainProfile: RenderLabTerrainProfile;
  roadStyle: RenderLabRoadStyle;
}): RenderLabAssetPack {
  return {
    id: options.id,
    label: options.label,
    description: options.description,
    groundColor: (terrain, seed) => tint(baseGroundColor(terrain, seed, options.groundVariation), options.groundBias),
    terrainProfile: options.terrainProfile,
    roadStyle: options.roadStyle,
    createTerrainFeature: (terrain, seed) => {
      switch (terrain) {
        case 'forest':
          return options.createTree(seed);
        case 'mountain':
          return options.createMountain(seed);
        case 'market':
          return createCurrentMarket();
        case 'water':
          return createWaterPlane(options.dryWaterColor, -0.06, 0.82, 0.12, 0.28);
        case 'deep_water':
          return createWaterPlane(options.deepWaterColor, -0.1, 0.9, 0.06, 0.34);
        case 'rocky':
          return createCurrentRocky(seed);
        case 'sand':
          return createCurrentSand(seed);
        case 'marsh':
          return createCurrentMarsh(seed);
        case 'plains':
          return null;
        default:
          return null;
      }
    },
    createBuilding: (buildingType, seed) => {
      switch (buildingType) {
        case 'storage':
          return options.createStorage(seed);
        case 'workshop':
          return options.createWorkshop(seed);
        case 'fortification':
          return options.createFortification(seed);
        default:
          return null;
      }
    },
    createPrototypeBuilding: (buildingType, seed) => createPrototypeBuilding(buildingType, seed),
  };
}

function createWildlandsStorage(seed: number): THREE.Object3D {
  const group = createCurrentStorage();
  group.scale.set(1.08, 1, 1.08);
  group.rotation.y = seeded(seed, 401) * 0.2 - 0.1;

  const crates = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.16, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.86 })
  );
  crates.position.set(0.46, 0.08, 0.12);
  crates.castShadow = true;
  group.add(crates);
  return group;
}

function createWildlandsWorkshop(seed: number): THREE.Object3D {
  const group = createCurrentWorkshop();
  group.scale.set(1.04, 1.06, 1.04);
  group.rotation.y = seeded(seed, 411) * 0.2 - 0.1;
  return group;
}

function createWildlandsFortification(seed: number): THREE.Object3D {
  const group = createCurrentFortification();
  group.scale.set(1.1, 1, 1.1);
  group.rotation.y = seeded(seed, 421) * 0.2 - 0.1;
  return group;
}

function createCitadelStorage(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.82, 0.54, 0.72),
    new THREE.MeshStandardMaterial({ color: 0xb6a181, roughness: 0.78, flatShading: true })
  );
  base.position.y = 0.27;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.56, 0.28, 4),
    new THREE.MeshStandardMaterial({ color: 0x7a5d37, roughness: 0.62, flatShading: true })
  );
  roof.rotation.y = Math.PI / 4 + seeded(seed, 431) * 0.2;
  roof.position.y = 0.69;
  roof.castShadow = true;
  group.add(roof);

  return group;
}

function createCitadelWorkshop(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const shell = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42, 0),
    new THREE.MeshStandardMaterial({ color: 0x767f8b, roughness: 0.82, flatShading: true })
  );
  shell.position.y = 0.45;
  shell.scale.set(1.2, 1, 1);
  shell.rotation.y = (seeded(seed, 932) - 0.5) * 0.3;
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  const forge = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.12, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xff6f2d, emissive: 0xff3a00, emissiveIntensity: 0.65, roughness: 0.3 })
  );
  forge.position.set(0, 0.3, 0.42);
  group.add(forge);

  const vent = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.1, 0.35, 6),
    new THREE.MeshStandardMaterial({ color: 0x4e555f, roughness: 0.87 })
  );
  vent.position.set(0.22, 0.73, -0.14);
  vent.castShadow = true;
  group.add(vent);

  return group;
}

function createCitadelFortification(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.5, 0.95),
    new THREE.MeshStandardMaterial({ color: 0x6a7281, roughness: 0.85, flatShading: true })
  );
  wall.position.y = 0.25;
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);

  const towerCount = 4;
  for (let i = 0; i < towerCount; i++) {
    const angle = (Math.PI / 2) * i + seeded(seed, 441) * 0.12;
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.14, 0.78, 6),
      new THREE.MeshStandardMaterial({ color: 0x586071, roughness: 0.82, flatShading: true })
    );
    tower.position.set(Math.cos(angle) * 0.38, 0.39, Math.sin(angle) * 0.38);
    tower.castShadow = true;
    group.add(tower);
  }

  return group;
}

function createFrontierTree(seed: number): THREE.Object3D {
  const group = new THREE.Group();
  const variant = seeded(seed, 501);

  if (variant < 0.34) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.08, 0.68, 7),
      new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.92 })
    );
    trunk.position.y = 0.34;
    trunk.castShadow = true;
    group.add(trunk);

    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 9, 7),
      new THREE.MeshStandardMaterial({ color: 0x2f7834, roughness: 0.78 })
    );
    canopy.position.y = 0.86;
    canopy.scale.set(1.12, 0.9, 1.08);
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    group.add(canopy);
    return group;
  }

  if (variant < 0.68) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.065, 0.56, 6),
      new THREE.MeshStandardMaterial({ color: 0x4f321f, roughness: 0.92, flatShading: true })
    );
    trunk.position.y = 0.28;
    trunk.castShadow = true;
    group.add(trunk);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.92, 7),
      new THREE.MeshStandardMaterial({ color: 0x2b6233, roughness: 0.86, flatShading: true })
    );
    cone.position.y = 0.78;
    cone.castShadow = true;
    cone.receiveShadow = true;
    group.add(cone);
    return group;
  }

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.06, 0.62, 6),
    new THREE.MeshStandardMaterial({ color: 0x6a4726, roughness: 0.9 })
  );
  trunk.position.y = 0.31;
  trunk.castShadow = true;
  group.add(trunk);

  for (let i = 0; i < 3; i++) {
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18 + seeded(seed, 511 + i) * 0.08, 0),
      new THREE.MeshStandardMaterial({ color: 0x3b8a42 + i * 0x040404, roughness: 0.74, flatShading: true })
    );
    blob.position.set((i - 1) * 0.16, 0.64 + i * 0.1, (seeded(seed, 521 + i) - 0.5) * 0.14);
    blob.castShadow = true;
    blob.receiveShadow = true;
    group.add(blob);
  }

  return group;
}

function createFrontierMountain(seed: number): THREE.Object3D {
  const group = new THREE.Group();
  const ridgeCount = 3 + Math.floor(seeded(seed, 531) * 3);

  for (let i = 0; i < ridgeCount; i++) {
    const height = 1.1 + seeded(seed, 541 + i) * 1.2;
    const radius = 0.24 + seeded(seed, 551 + i) * 0.25;
    const peak = new THREE.Mesh(
      new THREE.ConeGeometry(radius, height, 8),
      new THREE.MeshStandardMaterial({ color: 0x6b727b, roughness: 0.92, flatShading: true })
    );
    peak.position.set(
      (i - (ridgeCount - 1) / 2) * 0.22,
      height * 0.5,
      (seeded(seed, 561 + i) - 0.5) * 0.35
    );
    peak.rotation.y = seeded(seed, 571 + i) * Math.PI * 2;
    peak.castShadow = true;
    peak.receiveShadow = true;
    group.add(peak);
  }

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.82, 0.9, 0.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x565b62, roughness: 0.96, flatShading: true })
  );
  base.position.y = 0.1;
  base.receiveShadow = true;
  group.add(base);

  return group;
}

function createFrontierStorage(seed: number): THREE.Object3D {
  const group = createPrototypeBarn(seed);
  group.scale.set(1.05, 1, 1.05);
  return group;
}

function createFrontierWorkshop(seed: number): THREE.Object3D {
  const group = createPrototypeFoundry(seed);
  group.scale.set(0.96, 1.02, 0.96);
  return group;
}

function createFrontierFortification(seed: number): THREE.Object3D {
  const group = createPrototypeHall(seed);
  group.scale.set(1.08, 1, 1.08);
  group.rotation.y = seeded(seed, 581) * 0.35;
  return group;
}

const CURRENT_PACK = buildPack({
  id: 'current',
  label: 'Current Classic',
  description: 'Matches current production style and proportions.',
  createTree: createCurrentTree,
  createMountain: createCurrentMountain,
  createStorage: createCurrentStorage,
  createWorkshop: createCurrentWorkshop,
  createFortification: createCurrentFortification,
  dryWaterColor: 0x3a8fd4,
  deepWaterColor: 0x1a3a6a,
  marshColor: 0x4a7a6a,
  groundVariation: 0.05,
  groundBias: 0,
  terrainProfile: {
    baseHeight: {
      plains: 0.18,
      forest: 0.24,
      mountain: 1.08,
      market: 0.2,
      water: -0.18,
      rocky: 0.48,
      sand: 0.1,
      deep_water: -0.48,
      marsh: -0.08,
    },
    macroNoise: 0.2,
    microNoise: 0.08,
    ridgeNoise: 0.34,
    waterLevel: -0.12,
  },
  roadStyle: {
    baseColor: 0x73604b,
    lineColor: 0xb79a73,
    shoulderColor: 0x4d3f30,
  },
});

const WILDLANDS_PACK = buildPack({
  id: 'wildlands',
  label: 'Wildlands Dense',
  description: 'Denser organic vegetation and layered mountain silhouettes.',
  createTree: createWildlandsTree,
  createMountain: createWildlandsMountain,
  createStorage: createWildlandsStorage,
  createWorkshop: createWildlandsWorkshop,
  createFortification: createWildlandsFortification,
  dryWaterColor: 0x2f86c8,
  deepWaterColor: 0x15375f,
  marshColor: 0x416a5d,
  groundVariation: 0.08,
  groundBias: 0.02,
  terrainProfile: {
    baseHeight: {
      plains: 0.2,
      forest: 0.3,
      mountain: 1.24,
      market: 0.22,
      water: -0.24,
      rocky: 0.56,
      sand: 0.12,
      deep_water: -0.56,
      marsh: -0.12,
    },
    macroNoise: 0.28,
    microNoise: 0.11,
    ridgeNoise: 0.42,
    waterLevel: -0.18,
  },
  roadStyle: {
    baseColor: 0x66553f,
    lineColor: 0xaa8d66,
    shoulderColor: 0x4b3c2a,
  },
});

const CITADEL_PACK = buildPack({
  id: 'citadel',
  label: 'Citadel Low-Poly',
  description: 'Sharper forms with strong silhouettes for tactical readability.',
  createTree: createCitadelTree,
  createMountain: createCitadelMountain,
  createStorage: createCitadelStorage,
  createWorkshop: createCitadelWorkshop,
  createFortification: createCitadelFortification,
  dryWaterColor: 0x2e7aa7,
  deepWaterColor: 0x1f3354,
  marshColor: 0x3f6157,
  groundVariation: 0.06,
  groundBias: -0.01,
  terrainProfile: {
    baseHeight: {
      plains: 0.16,
      forest: 0.22,
      mountain: 1.14,
      market: 0.24,
      water: -0.2,
      rocky: 0.52,
      sand: 0.14,
      deep_water: -0.54,
      marsh: -0.14,
    },
    macroNoise: 0.22,
    microNoise: 0.09,
    ridgeNoise: 0.36,
    waterLevel: -0.16,
  },
  roadStyle: {
    baseColor: 0x62697a,
    lineColor: 0xb7c0d2,
    shoulderColor: 0x454b58,
  },
});

const FRONTIER_PACK = buildPack({
  id: 'frontier',
  label: 'Frontier Realism',
  description: 'Sandbox pack for open-world silhouettes with stronger terrain relief and settlement readability.',
  createTree: createFrontierTree,
  createMountain: createFrontierMountain,
  createStorage: createFrontierStorage,
  createWorkshop: createFrontierWorkshop,
  createFortification: createFrontierFortification,
  dryWaterColor: 0x2f88c0,
  deepWaterColor: 0x173754,
  marshColor: 0x3f6d63,
  groundVariation: 0.09,
  groundBias: 0.01,
  terrainProfile: {
    baseHeight: {
      plains: 0.24,
      forest: 0.34,
      mountain: 1.46,
      market: 0.26,
      water: -0.28,
      rocky: 0.66,
      sand: 0.16,
      deep_water: -0.62,
      marsh: -0.16,
    },
    macroNoise: 0.34,
    microNoise: 0.14,
    ridgeNoise: 0.56,
    waterLevel: -0.2,
  },
  roadStyle: {
    baseColor: 0x7b6750,
    lineColor: 0xc7a97d,
    shoulderColor: 0x4f4132,
  },
});

export const RENDER_LAB_ASSET_PACKS: RenderLabAssetPack[] = [
  CURRENT_PACK,
  WILDLANDS_PACK,
  CITADEL_PACK,
  FRONTIER_PACK,
];

const PACK_MAP = new Map<RenderLabAssetPackId, RenderLabAssetPack>(
  RENDER_LAB_ASSET_PACKS.map((pack) => [pack.id, pack])
);

export function getRenderLabAssetPack(id: RenderLabAssetPackId): RenderLabAssetPack {
  return PACK_MAP.get(id) ?? CURRENT_PACK;
}

export const RENDER_LAB_PROTOTYPE_BUILDINGS: PrototypeBuildingType[] = [
  'watchtower',
  'windmill',
  'greenhouse',
  'foundry',
  'cottage',
  'townhouse',
  'barn',
  'hall',
];
