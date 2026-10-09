// Sentry turret model: a fixed base and a yawing head with a barrel and a glow lamp. Geometry and
// materials follow index.html:1250-1251 (TURRET_MAT, TURRET_GLOW) and 1536-1553 (placeTurret). The
// head yaw follows 1572 (tu.head.rotation.y = tu.yaw). No DOM is touched; the caller places the group.
import * as THREE from 'three';

const TURRET_METAL = 0x4a5560;
const TURRET_GLOW = 0x58b7ff;

export interface TurretModel {
  // Stands on the origin. The caller sets group.position and adds it to the scene.
  group: THREE.Group;
  // Yaws with setYaw. The barrel points along local +z at yaw 0.
  head: THREE.Group;
  setYaw(yaw: number): void;
  // Removes the group from its parent and disposes its geometry and materials.
  dispose(): void;
}

export function turretModel(): TurretModel {
  const metal = new THREE.MeshStandardMaterial({ color: TURRET_METAL, roughness: 0.5, metalness: 0.5 });
  const glowMat = new THREE.MeshBasicMaterial({ color: TURRET_GLOW });
  const baseGeo = new THREE.CylinderGeometry(0.45, 0.55, 0.5, 12);
  const bodyGeo = new THREE.BoxGeometry(0.5, 0.3, 0.6);
  const barrelGeo = new THREE.BoxGeometry(0.1, 0.1, 0.9);
  const glowGeo = new THREE.SphereGeometry(0.06, 8, 6);

  const base = new THREE.Mesh(baseGeo, metal);
  base.position.y = 0.25;

  const head = new THREE.Group();
  head.position.y = 0.9;
  const body = new THREE.Mesh(bodyGeo, metal);
  const barrel = new THREE.Mesh(barrelGeo, metal);
  barrel.position.z = 0.6;
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(0, 0.2, 0.2);
  head.add(body, barrel, glow);

  const group = new THREE.Group();
  group.add(base, head);

  return {
    group,
    head,
    setYaw(yaw: number): void {
      head.rotation.y = yaw;
    },
    dispose(): void {
      group.removeFromParent();
      baseGeo.dispose();
      bodyGeo.dispose();
      barrelGeo.dispose();
      glowGeo.dispose();
      metal.dispose();
      glowMat.dispose();
    },
  };
}
