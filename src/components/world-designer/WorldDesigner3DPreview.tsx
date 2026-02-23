'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TerrainType } from '@/lib/types';
import { WorldDesignerTile } from '@/lib/world-designer';

interface WorldDesigner3DPreviewProps {
  title?: string;
  tiles: WorldDesignerTile[];
  centerX: number;
  centerY: number;
}

const COLORS: Record<TerrainType, number> = {
  plains: 0x6b983d,
  forest: 0x3e6e35,
  mountain: 0x777777,
  market: 0xf9cf4f,
  water: 0x4f9ddd,
  rocky: 0x5c5c63,
  sand: 0xdbbe73,
  deep_water: 0x244772,
  marsh: 0x4f7569,
};

const ELEVATION_UNIT_HEIGHT = 0.14;
const TILE_FLOOR_Y = -0.24;

function tintColor(colorHex: number, factor: number): number {
  const color = new THREE.Color(colorHex);
  color.multiplyScalar(factor);
  return color.getHex();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();

    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const mat of material) mat.dispose();
      return;
    }
    material.dispose();
  });
}

function tileSeed(x: number, y: number): number {
  let h = Math.imul(x + 11, 374761393) ^ Math.imul(y + 7, 668265263);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

function createMountain(seed: number): THREE.Object3D {
  const group = new THREE.Group();
  const height = 1.1 + (seed % 19) * 0.03;
  const radius = 0.42 + (seed % 11) * 0.02;

  const body = new THREE.Mesh(
    new THREE.ConeGeometry(radius, height, 6),
    new THREE.MeshStandardMaterial({
      color: 0x767676,
      roughness: 0.94,
      metalness: 0.02,
      flatShading: true,
    })
  );
  body.castShadow = true;
  body.receiveShadow = true;
  body.position.y = height * 0.5;
  group.add(body);

  if (height > 1.35) {
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 0.3, 0.18, 6),
      new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.66 })
    );
    cap.position.y = height * 0.9;
    group.add(cap);
  }

  return group;
}

function createTree(seed: number): THREE.Object3D {
  const group = new THREE.Group();
  const trunkHeight = 0.34 + (seed % 6) * 0.02;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.08, trunkHeight, 6),
    new THREE.MeshStandardMaterial({ color: 0x694628, roughness: 0.88 })
  );
  trunk.position.y = trunkHeight * 0.5;
  trunk.castShadow = true;
  group.add(trunk);

  const top = new THREE.Mesh(
    new THREE.ConeGeometry(0.36, 0.64, 8),
    new THREE.MeshStandardMaterial({
      color: seed % 2 === 0 ? 0x2d7a2f : 0x2b6d2e,
      roughness: 0.78,
      flatShading: true,
    })
  );
  top.position.y = trunkHeight + 0.32;
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  return group;
}

function createMarket(seed: number): THREE.Object3D {
  const group = new THREE.Group();

  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, 0.52, 0.62),
    new THREE.MeshStandardMaterial({ color: 0xe7ca92, roughness: 0.72 })
  );
  walls.position.y = 0.26;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.52, 0.34, 4),
    new THREE.MeshStandardMaterial({
      color: seed % 2 === 0 ? 0xbd5a42 : 0xb34f35,
      roughness: 0.65,
    })
  );
  roof.rotation.y = Math.PI * 0.25;
  roof.position.y = 0.64;
  roof.castShadow = true;
  group.add(roof);

  return group;
}

function createRocky(seed: number): THREE.Object3D {
  const group = new THREE.Group();
  const count = 2 + (seed % 3);

  for (let i = 0; i < count; i++) {
    const size = 0.06 + ((seed + i * 37) % 18) * 0.01;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(size, 0),
      new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? 0x5b5b60 : 0x6b6b73,
        roughness: 0.95,
        flatShading: true,
      })
    );
    const angle = ((seed + i * 87) % 360) * (Math.PI / 180);
    const dist = 0.08 + ((seed + i * 19) % 16) * 0.02;
    rock.position.set(Math.cos(angle) * dist, size * 0.65, Math.sin(angle) * dist);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  return group;
}

function createSand(seed: number): THREE.Object3D {
  const dune = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd9b463, roughness: 0.93 })
  );
  dune.scale.set(1.4, 0.45, 1);
  const angle = (seed % 360) * (Math.PI / 180);
  dune.position.set(Math.cos(angle) * 0.15, 0.01, Math.sin(angle) * 0.12);
  dune.receiveShadow = true;
  return dune;
}

function createMarsh(seed: number): THREE.Object3D {
  const group = new THREE.Group();
  const reeds = 2 + (seed % 3);

  for (let i = 0; i < reeds; i++) {
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.014, 0.3, 4),
      new THREE.MeshStandardMaterial({ color: 0x607f43, roughness: 0.86 })
    );
    const angle = ((seed + i * 113) % 360) * (Math.PI / 180);
    const dist = 0.04 + ((seed + i * 43) % 18) * 0.015;
    stalk.position.set(Math.cos(angle) * dist, 0.16, Math.sin(angle) * dist);
    group.add(stalk);
  }

  return group;
}

export function WorldDesigner3DPreview({
  title = '3D Preview',
  tiles,
  centerX,
  centerY,
}: WorldDesigner3DPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const terrainGroupRef = useRef<THREE.Group | null>(null);

  const cameraStateRef = useRef({
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    distance: 28,
    polar: 0.85,
    azimuth: 0.7,
  });

  const dragRef = useRef({
    dragging: false,
    x: 0,
    y: 0,
  });

  const tilesKey = useMemo(
    () => `${centerX},${centerY}:${tiles.length}:${tiles[0]?.x ?? 0},${tiles[0]?.y ?? 0}:${tiles[tiles.length - 1]?.x ?? 0},${tiles[tiles.length - 1]?.y ?? 0}`,
    [tiles, centerX, centerY]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd7ecff);
    scene.fog = new THREE.Fog(0xd7ecff, 24, 72);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 180);
    camera.position.set(16, 14, 16);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x88a7c9, 0.55);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff4de, 1.18);
    sun.position.set(24, 29, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -28;
    sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 28;
    sun.shadow.camera.bottom = -28;
    scene.add(sun);
    scene.add(sun.target);

    const group = new THREE.Group();
    group.name = 'world-designer-3d';
    terrainGroupRef.current = group;
    scene.add(group);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const onPointerDown = (event: PointerEvent) => {
      dragRef.current.dragging = true;
      dragRef.current.x = event.clientX;
      dragRef.current.y = event.clientY;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragRef.current.dragging) return;
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      dragRef.current.x = event.clientX;
      dragRef.current.y = event.clientY;

      cameraStateRef.current.azimuth -= dx * 0.006;
      cameraStateRef.current.polar = clamp(cameraStateRef.current.polar + dy * 0.005, 0.45, 1.36);
    };

    const onPointerUp = () => {
      dragRef.current.dragging = false;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraStateRef.current.distance = clamp(
        cameraStateRef.current.distance + event.deltaY * 0.02,
        8,
        56
      );
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    let animationFrame = 0;
    const animate = () => {
      animationFrame = window.requestAnimationFrame(animate);
      const state = cameraStateRef.current;
      const spherical = new THREE.Spherical(state.distance, state.polar, state.azimuth);
      const offset = new THREE.Vector3().setFromSpherical(spherical);
      camera.position.set(state.targetX + offset.x, Math.max(3, offset.y), state.targetZ + offset.z);
      camera.lookAt(state.targetX, state.targetY, state.targetZ);
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);

      if (terrainGroupRef.current) {
        disposeObject3D(terrainGroupRef.current);
        scene.remove(terrainGroupRef.current);
      }

      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      rendererRef.current = null;
      terrainGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = terrainGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeObject3D(child);
    }

    let elevationSum = 0;

    for (const tile of tiles) {
      const localX = tile.x - centerX;
      const localZ = tile.y - centerY;
      const seed = tileSeed(tile.x, tile.y);
      const terrain = tile.terrain;
      const terrainTopY = tile.elevation * ELEVATION_UNIT_HEIGHT;
      elevationSum += terrainTopY;

      const tileGroup = new THREE.Group();
      tileGroup.position.set(localX, 0, localZ);

      const waterOffset = terrain === 'deep_water' ? -0.16 : terrain === 'water' ? -0.08 : 0;
      const topY = terrainTopY + waterOffset;
      const columnHeight = Math.max(0.05, topY - TILE_FLOOR_Y);
      const topColor = COLORS[terrain];
      const sideColor = tintColor(topColor, 0.78);
      const bottomColor = tintColor(topColor, 0.55);

      const column = new THREE.Mesh(
        new THREE.BoxGeometry(1, columnHeight, 1),
        [
          new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.92, metalness: 0.02 }),
          new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.92, metalness: 0.02 }),
          new THREE.MeshStandardMaterial({
            color: topColor,
            roughness: terrain.includes('water') ? 0.26 : 0.88,
            metalness: terrain.includes('water') ? 0.3 : 0.03,
          }),
          new THREE.MeshStandardMaterial({ color: bottomColor, roughness: 0.95, metalness: 0.01 }),
          new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.92, metalness: 0.02 }),
          new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.92, metalness: 0.02 }),
        ]
      );
      column.position.y = TILE_FLOOR_Y + columnHeight * 0.5;
      column.castShadow = true;
      column.receiveShadow = true;
      tileGroup.add(column);

      let feature: THREE.Object3D | null = null;
      if (terrain === 'mountain') {
        feature = createMountain(seed);
      } else if (terrain === 'forest' && seed % 5 !== 0) {
        feature = createTree(seed);
      } else if (terrain === 'market') {
        feature = createMarket(seed);
      } else if (terrain === 'rocky' && seed % 2 === 0) {
        feature = createRocky(seed);
      } else if (terrain === 'sand' && seed % 3 !== 0) {
        feature = createSand(seed);
      } else if (terrain === 'marsh' && seed % 2 === 0) {
        feature = createMarsh(seed);
      }

      if (feature) {
        feature.position.y += topY;
        tileGroup.add(feature);
      }

      group.add(tileGroup);
    }
    cameraStateRef.current.targetY = tiles.length > 0 ? elevationSum / tiles.length : 0;
  }, [tilesKey, tiles, centerX, centerY]);

  return (
    <div className="rounded-xl border border-slate-300 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <span className="text-xs text-slate-500">
          Drag to orbit • Wheel to zoom • {tiles.length.toLocaleString()} tiles
        </span>
      </div>
      <div ref={containerRef} className="h-[380px] w-full bg-slate-100" />
    </div>
  );
}
