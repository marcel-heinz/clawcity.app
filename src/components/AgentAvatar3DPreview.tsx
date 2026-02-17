'use client';

import { useEffect, useMemo, useRef } from 'react';
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

  const resolvedAvatar = useMemo(() => resolveAvatar(name, avatar), [name, avatar]);
  const canRender3D = useMemo(() => {
    if (typeof window === 'undefined') return true;
    return webglSupported();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!canRender3D) return;

    let disposed = false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
    camera.position.set(0, 1.1, 3.5);
    camera.lookAt(0, 0.3, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearAlpha(0);
    container.appendChild(renderer.domElement);

    const crab = createCrabMesh({
      body: hexToThreeColor(resolvedAvatar.body_color),
      claw: hexToThreeColor(resolvedAvatar.claw_color),
      eye: hexToThreeColor(resolvedAvatar.eye_color),
    });
    crab.position.y = -0.05;
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
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
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
  }, [canRender3D, resolvedAvatar.body_color, resolvedAvatar.claw_color, resolvedAvatar.eye_color]);

  if (!canRender3D) {
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
