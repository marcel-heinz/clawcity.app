'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { AgentAvatar } from '@/lib/types';
import { CrabSprite } from '@/components/CrabSprite';
import { resolveAvatarLabConfig } from '@/lib/avatar-lab';
import { createAvatarLabMesh, disposeObject3D } from '@/lib/avatar-lab-mesh';

interface AgentAvatar3DPreviewProps {
  name: string;
  avatar?: AgentAvatar;
  className?: string;
}

function webglSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

export function AgentAvatar3DPreview({ name, avatar, className = '' }: AgentAvatar3DPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [render3DFailed, setRender3DFailed] = useState(false);

  const resolvedConfig = useMemo(() => resolveAvatarLabConfig(name, avatar), [name, avatar]);
  const canRender3D = useMemo(() => {
    if (typeof window === 'undefined') return true;
    return webglSupported();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!canRender3D || render3DFailed) return;

    let disposed = false;
    let skinLoadVersion = 0;
    let skinTexture: THREE.Texture | null = null;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      window.requestAnimationFrame(() => {
        if (!disposed) setRender3DFailed(true);
      });
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearAlpha(0);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (!disposed) setRender3DFailed(true);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(2.8, 3.4, 3);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdde8ff, 0.5);
    fillLight.position.set(-2, 2.2, -1.5);
    scene.add(fillLight);

    const build = createAvatarLabMesh(resolvedConfig);
    scene.add(build.root);

    const bounds = new THREE.Box3().setFromObject(build.root);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const centeredMinY = bounds.min.y - center.y;
    const baseLift = Math.max(0.15, 0.06 - centeredMinY + 0.03);
    build.root.position.sub(center);
    build.root.position.y = baseLift;

    if (resolvedConfig.skin_data_url) {
      const loadVersion = ++skinLoadVersion;
      const loader = new THREE.TextureLoader();
      loader.load(
        resolvedConfig.skin_data_url,
        (texture) => {
          if (disposed || loadVersion !== skinLoadVersion) {
            texture.dispose();
            return;
          }

          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(resolvedConfig.skin_scale, resolvedConfig.skin_scale);
          texture.center.set(0.5, 0.5);
          texture.rotation = Math.PI / 2;
          skinTexture = texture;

          const materials = [
            ...build.channels.primary,
            ...build.channels.secondary,
            ...build.channels.accent,
          ];

          for (const material of materials) {
            material.map = texture;
            material.color.lerp(new THREE.Color(0xffffff), resolvedConfig.skin_tint_strength);
            material.needsUpdate = true;
          }
        },
        undefined,
        () => {
          // Keep base materials if skin loading fails.
        }
      );
    }

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return;

      renderer.setSize(width, height, true);
      camera.aspect = width / height;

      const maxSize = Math.max(size.x, size.y, size.z);
      const fovRad = THREE.MathUtils.degToRad(camera.fov);
      const fitHeightDistance = maxSize / (2 * Math.tan(fovRad / 2));
      const fitWidthDistance = fitHeightDistance / camera.aspect;
      const distance = Math.max(fitHeightDistance, fitWidthDistance) * 2.1;

      camera.position.set(0, Math.max(size.y * 0.45, 0.5), distance);
      camera.lookAt(0, 0.24, 0);
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    window.addEventListener('orientationchange', resize);
    window.addEventListener('resize', resize);
    resize();

    let prev = performance.now();
    let elapsed = 0;

    const animate = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      elapsed += dt;

      build.root.rotation.y += dt * 0.8;
      build.root.position.y = baseLift + Math.sin(elapsed * 2.3) * 0.02;

      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(animate);
    };

    frameRef.current = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      skinLoadVersion += 1;

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      resizeObserver.disconnect();
      window.removeEventListener('orientationchange', resize);
      window.removeEventListener('resize', resize);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);

      if (skinTexture) {
        skinTexture.dispose();
        skinTexture = null;
      }

      disposeObject3D(build.root);
      renderer.dispose();

      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [
    canRender3D,
    render3DFailed,
    resolvedConfig,
  ]);

  if (!canRender3D || render3DFailed) {
    return (
      <div
        className={`w-24 h-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center ${className}`}
        style={{ backgroundColor: `${resolvedConfig.body_color}1f` }}
      >
        <CrabSprite animation="idle" scale={1.2} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`w-24 h-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden ${className}`}
      aria-label={`${name} avatar preview`}
    />
  );
}
