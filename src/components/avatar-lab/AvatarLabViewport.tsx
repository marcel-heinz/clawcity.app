'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ResolvedAvatarLabConfig } from '@/lib/avatar-lab';
import { createAvatarLabMesh, disposeObject3D } from '@/lib/avatar-lab-mesh';

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

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function animationMultiplier(mode: ResolvedAvatarLabConfig['animation_profile']): number {
  if (mode === 'energetic') return 1.8;
  if (mode === 'float') return 0.65;
  return 1;
}

export function AvatarLabViewport({ title, config, onMetrics }: AvatarLabViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onMetricsRef = useRef(onMetrics);

  const stableConfig = useMemo(() => config, [config]);

  useEffect(() => {
    onMetricsRef.current = onMetrics;
  }, [onMetrics]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    scene.fog = new THREE.Fog(0xffffff, 8, 30);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(0, 1.25, 3.6);
    camera.lookAt(0, 0.25, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.5, 48),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.98,
        metalness: 0.0,
      })
    );
    floor.receiveShadow = true;
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    scene.add(floor);

    const build = createAvatarLabMesh(stableConfig);
    const avatarRoot = new THREE.Group();
    avatarRoot.add(build.root);
    scene.add(avatarRoot);

    const bounds = new THREE.Box3().setFromObject(build.root);
    const center = bounds.getCenter(new THREE.Vector3());
    build.root.position.sub(center);
    build.root.position.y += 0.15;

    const materialsForTexture = [
      ...build.channels.primary,
      ...build.channels.secondary,
      ...build.channels.accent,
    ];

    let disposed = false;
    let skinTexture: THREE.Texture | null = null;
    if (stableConfig.skin_data_url) {
      const loader = new THREE.TextureLoader();
      loader.load(stableConfig.skin_data_url, (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(stableConfig.skin_scale, stableConfig.skin_scale);
        texture.center.set(0.5, 0.5);
        texture.rotation = Math.PI / 2;
        skinTexture = texture;

        for (const material of materialsForTexture) {
          material.map = texture;
          material.color.lerp(new THREE.Color(0xffffff), stableConfig.skin_tint_strength);
          material.needsUpdate = true;
        }
      });
    }

    const orbitState = {
      yaw: 0.35,
      pitch: 0.24,
      distance: 3.4,
      dragging: false,
      x: 0,
      y: 0,
    };

    const updateCamera = () => {
      const polar = Math.PI / 2 - orbitState.pitch;
      const spherical = new THREE.Spherical(
        orbitState.distance,
        clamp(polar, 0.4, Math.PI - 0.45),
        orbitState.yaw
      );
      const offset = new THREE.Vector3().setFromSpherical(spherical);
      camera.position.set(offset.x, 0.6 + offset.y, offset.z);
      camera.lookAt(0, 0.22, 0);
    };
    updateCamera();

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

    const perf = {
      frameCount: 0,
      elapsedMs: 0,
      lastSampleMs: 0,
    };

    let frameId = 0;
    let last = performance.now();
    let elapsed = 0;
    const animSpeed = animationMultiplier(stableConfig.animation_profile);

    const animate = () => {
      if (disposed) return;
      frameId = window.requestAnimationFrame(animate);

      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      elapsed += dt * animSpeed;

      const bob = stableConfig.animation_profile === 'float'
        ? Math.sin(elapsed * 2) * 0.16
        : Math.sin(elapsed * 2.6) * 0.06;
      avatarRoot.position.y = bob;
      avatarRoot.rotation.y += dt * (0.58 + animSpeed * 0.12);

      renderer.render(scene, camera);

      perf.frameCount += 1;
      perf.elapsedMs += dt * 1000;
      if (onMetricsRef.current && now - perf.lastSampleMs >= 700) {
        const fps = perf.elapsedMs > 0 ? (perf.frameCount * 1000) / perf.elapsedMs : 0;
        const frameMs = fps > 0 ? 1000 / fps : 0;
        onMetricsRef.current({
          fps,
          frameMs,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
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

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });

    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('wheel', handleWheel);

      if (skinTexture) {
        skinTexture.dispose();
      }
      floor.geometry.dispose();
      if (floor.material instanceof THREE.Material) {
        floor.material.dispose();
      }
      disposeObject3D(avatarRoot);
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [stableConfig]);

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
