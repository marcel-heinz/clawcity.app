'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { AgentAvatar } from '@/lib/types';
import { CrabSprite } from '@/components/CrabSprite';
import { resolveAvatar, hexToThreeColor } from '@/lib/avatar';
import { createCrabMesh } from '@/lib/crab-mesh';

interface AgentAvatar3DPreviewProps {
  name: string;
  avatar?: AgentAvatar;
  className?: string;
}

function webglSupported(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

export function AgentAvatar3DPreview({ name, avatar, className = '' }: AgentAvatar3DPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [render3DFailed, setRender3DFailed] = useState(false);

  const resolvedAvatar = useMemo(() => resolveAvatar(name, avatar), [name, avatar]);
  const canRender3D = useMemo(() => {
    if (typeof window === 'undefined') return true;
    return webglSupported();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!canRender3D || render3DFailed) return;

    let disposed = false;
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

    const crab = createCrabMesh({
      body: hexToThreeColor(resolvedAvatar.body_color),
      claw: hexToThreeColor(resolvedAvatar.claw_color),
      eye: hexToThreeColor(resolvedAvatar.eye_color),
    });
    crab.updateMatrixWorld(true);
    const crabBounds = new THREE.Box3().setFromObject(crab);
    const crabCenter = crabBounds.getCenter(new THREE.Vector3());
    const crabSize = crabBounds.getSize(new THREE.Vector3());
    crab.position.sub(crabCenter);
    scene.add(crab);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
    keyLight.position.set(2.8, 3.4, 3);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdde8ff, 0.5);
    fillLight.position.set(-2, 2.2, -1.5);
    scene.add(fillLight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambient);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, true);
      camera.aspect = width / height;
      const maxSize = Math.max(crabSize.x, crabSize.y, crabSize.z);
      const fovRad = THREE.MathUtils.degToRad(camera.fov);
      const fitHeightDistance = maxSize / (2 * Math.tan(fovRad / 2));
      const fitWidthDistance = fitHeightDistance / camera.aspect;
      const distance = Math.max(fitHeightDistance, fitWidthDistance) * 2.2;
      camera.position.set(0, crabSize.y * 0.35, distance);
      camera.lookAt(0, crabSize.y * 0.05, 0);
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    window.addEventListener('orientationchange', resize);
    window.addEventListener('resize', resize);
    resize();

    let prev = performance.now();
    const animate = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      crab.rotation.y += dt * 0.8; // slow, continuous showcase spin
      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(animate);
    };
    frameRef.current = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      resizeObserver.disconnect();
      window.removeEventListener('orientationchange', resize);
      window.removeEventListener('resize', resize);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((material) => material.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [canRender3D, render3DFailed, resolvedAvatar.body_color, resolvedAvatar.claw_color, resolvedAvatar.eye_color]);

  if (!canRender3D || render3DFailed) {
    return (
      <div
        className={`w-24 h-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center ${className}`}
        style={{ backgroundColor: `${resolvedAvatar.body_color}1f` }}
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
