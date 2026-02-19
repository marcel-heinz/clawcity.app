'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  getRenderLabAssetPack,
  PrototypeBuildingType,
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

const DEFAULT_FOG = { near: 30, far: 90 };
const DEFAULT_EXPOSURE = 1.1;
const DEFAULT_AMBIENT = 0.45;
const DEFAULT_SUN = 1.2;

const CAMERA_PRESETS: Record<RenderLabCameraPreset, CameraPreset> = {
  cinematic: { distance: 18, polar: 1.08, azimuth: 0.4, fov: 60 },
  isometric: { distance: 22, polar: 0.94, azimuth: Math.PI / 4, fov: 50 },
  tactical: { distance: 30, polar: 0.78, azimuth: 0.6, fov: 44 },
  topdown: { distance: 38, polar: 0.22, azimuth: 0.1, fov: 40 },
};

const CAMERA_LIMITS = {
  distanceMin: 6,
  distanceMax: 80,
  polarMin: 0.12,
  polarMax: 1.45,
};

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

  if (seeded(seed, 7001) > density) {
    return null;
  }

  const index = Math.floor(seeded(seed, 7002) * RENDER_LAB_PROTOTYPE_BUILDINGS.length);
  return RENDER_LAB_PROTOTYPE_BUILDINGS[index] ?? null;
}

function featureDensityApplies(terrain: TerrainType): boolean {
  return terrain !== 'water' && terrain !== 'deep_water' && terrain !== 'market' && terrain !== 'plains';
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
  const onMetricsRef = useRef(onMetrics);

  const activePack = useMemo(() => getRenderLabAssetPack(packId), [packId]);

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

    const camera = new THREE.PerspectiveCamera(CAMERA_PRESETS.isometric.fov, 1, 0.1, 300);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.physicallyCorrectLights = true;
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
    sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
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
      const moveSpeed = 10;
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

      waterMeshesRef.current.forEach((mesh, idx) => {
        const baseY = Number(mesh.userData.waterBaseY ?? -0.05);
        const wave = Math.sin(elapsed * 1.6 + idx * 0.17 + mesh.position.x * 0.6) * 0.018;
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
      gridRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (controls.showGrid) {
      if (!gridRef.current) {
        const grid = new THREE.GridHelper(160, 160, 0x6f7a88, 0x5a6674);
        grid.position.y = -0.015;
        grid.material.opacity = 0.22;
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

    for (const tile of tiles) {
      const seed = tileSeed(tile.x, tile.y);

      const tileGroup = new THREE.Group();
      tileGroup.position.set(tile.x - centerX, 0, tile.y - centerY);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1.01, 1.01),
        new THREE.MeshStandardMaterial({
          color: activePack.groundColor(tile.terrain, seed),
          roughness: 0.88,
        })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      tileGroup.add(ground);

      if (tile.owner_id) {
        const ownerOverlay = new THREE.Mesh(
          new THREE.PlaneGeometry(0.95, 0.95),
          new THREE.MeshStandardMaterial({
            color: 0x66ff7f,
            transparent: true,
            opacity: 0.14,
            roughness: 0.4,
          })
        );
        ownerOverlay.rotation.x = -Math.PI / 2;
        ownerOverlay.position.y = 0.003;
        tileGroup.add(ownerOverlay);
      }

      let feature: THREE.Object3D | null = null;

      if (tile.building_type) {
        feature = activePack.createBuilding(tile.building_type, seed);
      } else if (controls.showPrototypeBuildings) {
        const prototype = pickPrototypeType(tile, seed, controls.prototypeDensity);
        if (prototype) {
          feature = activePack.createPrototypeBuilding(prototype, seed);
        }
      }

      if (!feature) {
        const canShowFeature = !featureDensityApplies(tile.terrain)
          || seeded(seed, 1001) <= controls.featureDensity;
        if (canShowFeature) {
          feature = activePack.createTerrainFeature(tile.terrain, seed);
        }
      }

      if (feature) {
        const jx = (seeded(seed, 2001) - 0.5) * controls.jitter;
        const jz = (seeded(seed, 2002) - 0.5) * controls.jitter;

        feature.position.x += jx;
        feature.position.z += jz;
        feature.scale.multiplyScalar(controls.assetScale);

        feature.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = true;
            node.receiveShadow = true;
            if (node.userData.isWater) {
              loadedWaterMeshes.push(node);
            }
          }
        });

        tileGroup.add(feature);
      }

      root.add(tileGroup);
    }

    waterMeshesRef.current = loadedWaterMeshes;

    cameraStateRef.current.targetX = 0;
    cameraStateRef.current.targetZ = 0;
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
