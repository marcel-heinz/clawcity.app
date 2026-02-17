import * as THREE from 'three';

export interface CrabMeshColors {
  body: number;
  claw: number;
  eye: number;
}

/**
 * Build the same crab mesh used in the 3D gameplay renderer.
 */
export function createCrabMesh(colors: CrabMeshColors): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.6, metalness: 0.1 });
  const clawMat = new THREE.MeshStandardMaterial({ color: colors.claw, roughness: 0.6, metalness: 0.1 });

  // Body
  const bodyGeo = new THREE.BoxGeometry(0.5, 0.25, 0.4);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.2;
  body.castShadow = true;
  group.add(body);

  // Eyes
  const eyeGeo = new THREE.BoxGeometry(0.08, 0.1, 0.08);
  const eyeMat = new THREE.MeshStandardMaterial({ color: colors.eye, roughness: 0.3 });
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.12, 0.38, 0.15);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.12, 0.38, 0.15);
  group.add(leftEye, rightEye);

  // Eye whites (small sphere)
  const whiteGeo = new THREE.SphereGeometry(0.03, 6, 6);
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const leftWhite = new THREE.Mesh(whiteGeo, whiteMat);
  leftWhite.position.set(-0.12, 0.42, 0.19);
  const rightWhite = new THREE.Mesh(whiteGeo, whiteMat);
  rightWhite.position.set(0.12, 0.42, 0.19);
  group.add(leftWhite, rightWhite);

  // Claws
  const clawGeo = new THREE.BoxGeometry(0.2, 0.15, 0.18);
  const leftClaw = new THREE.Mesh(clawGeo, clawMat);
  leftClaw.position.set(-0.42, 0.18, 0.12);
  leftClaw.castShadow = true;
  const rightClaw = new THREE.Mesh(clawGeo, clawMat);
  rightClaw.position.set(0.42, 0.18, 0.12);
  rightClaw.castShadow = true;
  group.add(leftClaw, rightClaw);

  // Legs (small cylinders)
  const legGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.15, 4);
  const legMat = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.7 });
  for (let i = 0; i < 3; i++) {
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.2, 0.08, -0.1 + i * 0.15);
    leftLeg.rotation.z = 0.4;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.2, 0.08, -0.1 + i * 0.15);
    rightLeg.rotation.z = -0.4;
    group.add(rightLeg);
  }

  return group;
}
