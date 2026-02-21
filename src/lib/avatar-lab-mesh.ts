import * as THREE from 'three';
import { AvatarLabModelId, ResolvedAvatarLabConfig } from '@/lib/avatar-lab';
import { hexToThreeColor } from '@/lib/avatar';

export interface AvatarLabMaterialChannels {
  primary: THREE.MeshStandardMaterial[];
  secondary: THREE.MeshStandardMaterial[];
  accent: THREE.MeshStandardMaterial[];
}

export interface AvatarLabMeshBuild {
  root: THREE.Group;
  channels: AvatarLabMaterialChannels;
}

function createMaterial(
  hex: string,
  roughness: number,
  metalness: number
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: hexToThreeColor(hex),
    roughness,
    metalness,
  });
}

function addMesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
  rotation?: { x?: number; y?: number; z?: number }
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  if (rotation) {
    mesh.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function createCrabModel(config: ResolvedAvatarLabConfig): AvatarLabMeshBuild {
  const root = new THREE.Group();
  const primary = createMaterial(config.body_color, config.material_roughness, config.material_metalness);
  const secondary = createMaterial(config.claw_color, config.material_roughness, config.material_metalness);
  const accent = createMaterial(config.accent_color, config.material_roughness * 0.8, config.material_metalness);
  const eye = createMaterial(config.eye_color, 0.32, 0.1);

  addMesh(root, new THREE.BoxGeometry(0.56, 0.24, 0.46), primary, 0, 0.22, 0);
  addMesh(root, new THREE.BoxGeometry(0.2, 0.16, 0.2), secondary, -0.44, 0.18, 0.14);
  addMesh(root, new THREE.BoxGeometry(0.2, 0.16, 0.2), secondary, 0.44, 0.18, 0.14);
  addMesh(root, new THREE.BoxGeometry(0.08, 0.12, 0.08), eye, -0.12, 0.4, 0.16);
  addMesh(root, new THREE.BoxGeometry(0.08, 0.12, 0.08), eye, 0.12, 0.4, 0.16);
  addMesh(root, new THREE.SphereGeometry(0.03, 8, 8), accent, -0.12, 0.44, 0.2);
  addMesh(root, new THREE.SphereGeometry(0.03, 8, 8), accent, 0.12, 0.44, 0.2);

  const legGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.18, 5);
  for (let i = 0; i < 3; i++) {
    const z = -0.14 + i * 0.16;
    addMesh(root, legGeometry, accent, -0.23, 0.09, z, { z: 0.48 });
    addMesh(root, legGeometry, accent, 0.23, 0.09, z, { z: -0.48 });
  }

  return { root, channels: { primary: [primary], secondary: [secondary], accent: [accent] } };
}

function createBeetleModel(config: ResolvedAvatarLabConfig): AvatarLabMeshBuild {
  const root = new THREE.Group();
  const primary = createMaterial(config.body_color, config.material_roughness, config.material_metalness + 0.08);
  const secondary = createMaterial(config.claw_color, config.material_roughness * 0.85, config.material_metalness + 0.05);
  const accent = createMaterial(config.accent_color, config.material_roughness * 0.6, config.material_metalness + 0.15);
  const eye = createMaterial(config.eye_color, 0.28, 0.18);

  addMesh(root, new THREE.SphereGeometry(0.29, 18, 16), primary, 0, 0.24, 0);
  addMesh(root, new THREE.SphereGeometry(0.22, 16, 14), primary, 0, 0.28, -0.2, { x: -0.2 });
  addMesh(root, new THREE.BoxGeometry(0.06, 0.18, 0.54), accent, 0, 0.35, -0.02);
  addMesh(root, new THREE.CapsuleGeometry(0.06, 0.32, 4, 12), secondary, -0.34, 0.2, 0.08, { y: 0.6, z: 0.15 });
  addMesh(root, new THREE.CapsuleGeometry(0.06, 0.32, 4, 12), secondary, 0.34, 0.2, 0.08, { y: -0.6, z: -0.15 });
  addMesh(root, new THREE.SphereGeometry(0.05, 10, 10), eye, -0.12, 0.42, 0.12);
  addMesh(root, new THREE.SphereGeometry(0.05, 10, 10), eye, 0.12, 0.42, 0.12);

  const legGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.24, 6);
  for (let i = 0; i < 3; i++) {
    const z = -0.18 + i * 0.17;
    addMesh(root, legGeometry, secondary, -0.22, 0.08, z, { z: 0.95 });
    addMesh(root, legGeometry, secondary, 0.22, 0.08, z, { z: -0.95 });
  }

  return { root, channels: { primary: [primary], secondary: [secondary], accent: [accent] } };
}

function createSentinelModel(config: ResolvedAvatarLabConfig): AvatarLabMeshBuild {
  const root = new THREE.Group();
  const primary = createMaterial(config.body_color, config.material_roughness * 0.75, config.material_metalness + 0.22);
  const secondary = createMaterial(config.claw_color, config.material_roughness * 0.65, config.material_metalness + 0.26);
  const accent = createMaterial(config.accent_color, config.material_roughness * 0.45, config.material_metalness + 0.35);
  const eye = createMaterial(config.eye_color, 0.22, 0.25);

  addMesh(root, new THREE.SphereGeometry(0.29, 20, 18), primary, 0, 0.3, 0);
  addMesh(root, new THREE.TorusGeometry(0.38, 0.05, 14, 36), secondary, 0, 0.3, 0, { x: Math.PI / 2.6 });
  addMesh(root, new THREE.TorusGeometry(0.28, 0.03, 12, 28), accent, 0, 0.3, 0, { y: Math.PI / 2.2 });
  addMesh(root, new THREE.SphereGeometry(0.07, 14, 12), eye, 0, 0.3, 0.26);

  const finGeometry = new THREE.BoxGeometry(0.07, 0.32, 0.11);
  addMesh(root, finGeometry, secondary, 0.34, 0.3, 0, { z: 0.42 });
  addMesh(root, finGeometry, secondary, -0.34, 0.3, 0, { z: -0.42 });
  addMesh(root, finGeometry, secondary, 0, 0.62, 0, { x: 0.3 });

  return { root, channels: { primary: [primary], secondary: [secondary], accent: [accent] } };
}

function buildByModel(modelId: AvatarLabModelId, config: ResolvedAvatarLabConfig): AvatarLabMeshBuild {
  if (modelId === 'beetle') return createBeetleModel(config);
  if (modelId === 'sentinel') return createSentinelModel(config);
  return createCrabModel(config);
}

export function createAvatarLabMesh(config: ResolvedAvatarLabConfig): AvatarLabMeshBuild {
  return buildByModel(config.model_type, config);
}

export function disposeObject3D(root: THREE.Object3D): void {
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
