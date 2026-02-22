'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ResolvedAvatarLabConfig } from '@/lib/avatar-lab';
import { AvatarLabMeshBuild, createAvatarLabMesh, disposeObject3D } from '@/lib/avatar-lab-mesh';

export interface AvatarLabPerfMetrics {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

interface AvatarLabViewportProps {
  title: string;
  config: ResolvedAvatarLabConfig;
  onMetrics?: (metrics: AvatarLabPerfMetrics) => void;
}

interface BobSettings {
  amplitude: number;
  frequency: number;
  rotationSpeed: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getBobSettings(mode: ResolvedAvatarLabConfig['animation_profile']): BobSettings {
  if (mode === 'energetic') {
    return { amplitude: 0.052, frequency: 3.2, rotationSpeed: 0.84 };
  }
  if (mode === 'float') {
    return { amplitude: 0.08, frequency: 1.35, rotationSpeed: 0.48 };
  }
  return { amplitude: 0.034, frequency: 2.2, rotationSpeed: 0.62 };
}

function createGrassFloorTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const tileSize = 96;
  const stride = 16;
  const canvas = document.createElement('canvas');
  canvas.width = tileSize;
  canvas.height = tileSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.colorSpace = THREE.SRGBColorSpace;
    return fallback;
  }

  ctx.fillStyle = '#7cb342';
  ctx.fillRect(0, 0, tileSize, tileSize);

  const dots: Array<{ x: number; y: number; r: number; c: string }> = [
    { x: 4, y: 4, r: 2.2, c: '#8bc34a' },
    { x: 12, y: 12, r: 2.1, c: '#689f38' },
    { x: 8, y: 2, r: 1.4, c: '#9ccc65' },
    { x: 3, y: 13, r: 1.4, c: '#9ccc65' },
    { x: 14, y: 6, r: 1.2, c: '#689f38' },
  ];

  for (let y = 0; y < tileSize; y += stride) {
    for (let x = 0; x < tileSize; x += stride) {
      for (const dot of dots) {
        ctx.fillStyle = dot.c;
        ctx.beginPath();
        ctx.arc(x + dot.x, y + dot.y, dot.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

export function AvatarLabViewport({ title, config, onMetrics }: AvatarLabViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onMetricsRef = useRef(onMetrics);

  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const floorRef = useRef<THREE.Mesh | null>(null);
  const floorTextureRef = useRef<THREE.Texture | null>(null);
  const avatarHostRef = useRef<THREE.Group | null>(null);
  const avatarBuildRef = useRef<AvatarLabMeshBuild | null>(null);
  const skinTextureRef = useRef<THREE.Texture | null>(null);
  const bobSettingsRef = useRef<BobSettings>(getBobSettings('idle'));
  const baseLiftRef = useRef(0.2);
  const skinLoadVersionRef = useRef(0);

  useEffect(() => {
    onMetricsRef.current = onMetrics;
  }, [onMetrics]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    scene.fog = new THREE.Fog(0xffffff, 8, 30);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(0, 1.25, 3.6);
    camera.lookAt(0, 0.25, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.72);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2.8, 3.8, 3.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.3;
    key.shadow.camera.far = 24;
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -3;
    scene.add(key);
    scene.add(key.target);

    const rim = new THREE.DirectionalLight(0xcfd8e6, 0.35);
    rim.position.set(-2, 1.6, -2.4);
    scene.add(rim);

    const floorTexture = createGrassFloorTexture(renderer);
    floorTextureRef.current = floorTexture;

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.5, 72),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: floorTexture,
        roughness: 0.96,
        metalness: 0.0,
      })
    );
    floor.receiveShadow = true;
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    floorRef.current = floor;
    scene.add(floor);

    const avatarHost = new THREE.Group();
    avatarHostRef.current = avatarHost;
    scene.add(avatarHost);

    const orbitState = {
      yaw: 0.35,
      pitch: 0.24,
      distance: 3.4,
      dragging: false,
      x: 0,
      y: 0,
    };

    const updateCamera = () => {
      const activeCamera = cameraRef.current;
      if (!activeCamera) return;
      const polar = Math.PI / 2 - orbitState.pitch;
      const spherical = new THREE.Spherical(
        orbitState.distance,
        clamp(polar, 0.4, Math.PI - 0.45),
        orbitState.yaw
      );
      const offset = new THREE.Vector3().setFromSpherical(spherical);
      activeCamera.position.set(offset.x, 0.6 + offset.y, offset.z);
      activeCamera.lookAt(0, 0.22, 0);
    };
    updateCamera();

    const resize = () => {
      const activeCamera = cameraRef.current;
      const activeRenderer = rendererRef.current;
      if (!activeCamera || !activeRenderer) return;

      const w = container.clientWidth;
      const h = container.clientHeight;
      activeCamera.aspect = w / Math.max(h, 1);
      activeCamera.updateProjectionMatrix();
      activeRenderer.setSize(w, h, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const perf = {
      frameCount: 0,
      elapsedMs: 0,
      lastSampleMs: 0,
    };

    let frameId = 0;
    let last = performance.now();
    let elapsed = 0;
    let disposed = false;

    const animate = () => {
      if (disposed) return;
      frameId = window.requestAnimationFrame(animate);

      const activeRenderer = rendererRef.current;
      const activeScene = sceneRef.current;
      const activeCamera = cameraRef.current;
      const activeAvatarHost = avatarHostRef.current;
      if (!activeRenderer || !activeScene || !activeCamera || !activeAvatarHost) return;

      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      const settings = bobSettingsRef.current;
      elapsed += dt;

      const bob = Math.sin(elapsed * settings.frequency) * settings.amplitude;

      activeAvatarHost.position.y = baseLiftRef.current + bob;
      activeAvatarHost.rotation.y += dt * settings.rotationSpeed;

      activeRenderer.render(activeScene, activeCamera);

      perf.frameCount += 1;
      perf.elapsedMs += dt * 1000;
      if (onMetricsRef.current && now - perf.lastSampleMs >= 700) {
        const fps = perf.elapsedMs > 0 ? (perf.frameCount * 1000) / perf.elapsedMs : 0;
        const frameMs = fps > 0 ? 1000 / fps : 0;
        onMetricsRef.current({
          fps,
          frameMs,
          drawCalls: activeRenderer.info.render.calls,
          triangles: activeRenderer.info.render.triangles,
          geometries: activeRenderer.info.memory.geometries,
          textures: activeRenderer.info.memory.textures,
        });
        perf.frameCount = 0;
        perf.elapsedMs = 0;
        perf.lastSampleMs = now;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      orbitState.dragging = true;
      orbitState.x = event.clientX;
      orbitState.y = event.clientY;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!orbitState.dragging) return;
      const dx = event.clientX - orbitState.x;
      const dy = event.clientY - orbitState.y;
      orbitState.x = event.clientX;
      orbitState.y = event.clientY;
      orbitState.yaw -= dx * 0.008;
      orbitState.pitch = clamp(orbitState.pitch - dy * 0.008, -0.3, 0.7);
      updateCamera();
    };

    const handlePointerUp = () => {
      orbitState.dragging = false;
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      orbitState.distance = clamp(orbitState.distance + event.deltaY * 0.01, 1.8, 7);
      updateCamera();
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();

      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);

      skinLoadVersionRef.current += 1;
      if (skinTextureRef.current) {
        skinTextureRef.current.dispose();
        skinTextureRef.current = null;
      }

      if (avatarBuildRef.current && avatarHostRef.current) {
        avatarHostRef.current.remove(avatarBuildRef.current.root);
        disposeObject3D(avatarBuildRef.current.root);
        avatarBuildRef.current = null;
      }

      if (floorRef.current) {
        floorRef.current.geometry.dispose();
        if (floorRef.current.material instanceof THREE.Material) {
          floorRef.current.material.dispose();
        }
        floorRef.current = null;
      }
      if (floorTextureRef.current) {
        floorTextureRef.current.dispose();
        floorTextureRef.current = null;
      }

      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }

      rendererRef.current = null;
      cameraRef.current = null;
      sceneRef.current = null;
      avatarHostRef.current = null;
    };
  }, []);

  useEffect(() => {
    const avatarHost = avatarHostRef.current;
    if (!avatarHost) return;

    const bobSettings = getBobSettings(config.animation_profile);
    bobSettingsRef.current = bobSettings;
    skinLoadVersionRef.current += 1;
    const loadVersion = skinLoadVersionRef.current;

    if (skinTextureRef.current) {
      skinTextureRef.current.dispose();
      skinTextureRef.current = null;
    }

    if (avatarBuildRef.current) {
      avatarHost.remove(avatarBuildRef.current.root);
      disposeObject3D(avatarBuildRef.current.root);
      avatarBuildRef.current = null;
    }

    const build = createAvatarLabMesh(config);
    const bounds = new THREE.Box3().setFromObject(build.root);
    const center = bounds.getCenter(new THREE.Vector3());
    const centeredMinY = bounds.min.y - center.y;

    const minimumClearance = 0.06;
    const bobDownwardAllowance = bobSettings.amplitude;
    const safetyPadding = 0.014;
    const baseLift = minimumClearance - centeredMinY + bobDownwardAllowance + safetyPadding;

    build.root.position.sub(center);
    baseLiftRef.current = baseLift;
    avatarHost.position.y = baseLift;
    avatarHost.add(build.root);
    avatarBuildRef.current = build;

    if (!config.skin_data_url) return;

    const loader = new THREE.TextureLoader();
    loader.load(config.skin_data_url, (texture) => {
      if (loadVersion !== skinLoadVersionRef.current || !avatarBuildRef.current || avatarBuildRef.current !== build) {
        texture.dispose();
        return;
      }

      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(config.skin_scale, config.skin_scale);
      texture.center.set(0.5, 0.5);
      texture.rotation = Math.PI / 2;
      skinTextureRef.current = texture;

      const materials = [
        ...build.channels.primary,
        ...build.channels.secondary,
        ...build.channels.accent,
      ];

      for (const material of materials) {
        material.map = texture;
        material.color.lerp(new THREE.Color(0xffffff), config.skin_tint_strength);
        material.needsUpdate = true;
      }
    });
  }, [config]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 text-sm font-semibold text-[var(--foreground)]">{title}</div>
      <div
        ref={containerRef}
        className="h-[320px] w-full overflow-hidden rounded border border-[var(--border)] bg-white"
      />
      <div className="mt-2 text-xs text-[var(--muted)]">
        Drag to orbit • Scroll to zoom
      </div>
    </div>
  );
}
