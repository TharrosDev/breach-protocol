// Box-built first-person gun models. Geometry and materials follow index.html:1154-1183.
// No DOM is touched here: the caller adds the group to the scene.
import * as THREE from 'three';
import { SIDEARM_ID, type PrimaryWeaponId } from '../content/ids';

export type GunId = PrimaryWeaponId | typeof SIDEARM_ID;

export interface GunPart {
  // Barrel length factor. index.html:487-493 (`len`).
  len: number;
  // Metal colour. index.html:487-493 (`color`).
  color: number;
}

export const GUN_PARTS: Readonly<Record<GunId, GunPart>> = {
  vx: { len: 1.0, color: 0x30363f },
  kv: { len: 0.7, color: 0x2a2e35 },
  bk: { len: 1.2, color: 0x5a4a3a },
  lm: { len: 1.1, color: 0x3b4a33 },
  dm: { len: 1.05, color: 0x2f3640 },
  vp: { len: 0.35, color: 0x3a2e2a },
};

export interface GunModel {
  group: THREE.Group;
  // The magazine, which the viewmodel drops during a reload (magY in gunPose).
  mag: THREE.Object3D;
  // Local z of the muzzle tip, used to place the muzzle flash.
  muzzleZ: number;
}

function isGunId(id: string): id is GunId {
  return Object.prototype.hasOwnProperty.call(GUN_PARTS, id);
}

// index.html:1154-1183. Throws for an unknown id.
export function buildGunModel(id: string): GunModel {
  if (!isGunId(id)) throw new Error(`Unknown gun id: ${id}`);
  const { len, color } = GUN_PARTS[id];

  const L2 = 0.25 + len * 0.45;
  const b = 0.15 + len * 0.25;
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.45 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.8 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x2d3a2b, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a77f, roughness: 0.8 });

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  // Receiver, barrel, muzzle, sight post, magazine, grip, stock.
  add(new THREE.BoxGeometry(0.075, 0.1, L2), metal, 0, 0, -L2 / 2);
  add(new THREE.BoxGeometry(0.03, 0.035, b), metal, 0, 0.01, -L2 - b / 2);
  add(new THREE.BoxGeometry(0.02, 0.04, 0.04), metal, 0, 0.07, -L2 * 0.6);
  const mag = add(new THREE.BoxGeometry(0.05, 0.14, 0.07), poly, 0, -0.11, -L2 * 0.45);
  add(new THREE.BoxGeometry(0.06, 0.09, 0.2), poly, 0, -0.02, 0.1);
  add(new THREE.BoxGeometry(0.05, 0.12, 0.06), poly, 0, -0.1, 0.0);

  // Per-weapon extras.
  if (id === 'dm') {
    const scope = add(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10), metal, 0, 0.11, -L2 * 0.35);
    scope.rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.05, 0.03, 0.08), poly, 0, 0.08, -L2 * 0.35);
  }
  if (id === 'lm') add(new THREE.BoxGeometry(0.08, 0.03, 0.2), poly, 0, -0.04, -L2 * 0.8);
  if (id === 'bk') add(new THREE.BoxGeometry(0.09, 0.08, 0.5), poly, 0, -0.01, -L2 * 0.5);

  // Arms: two sleeves and two hands.
  add(new THREE.BoxGeometry(0.08, 0.08, 0.3), sleeve, 0.02, -0.16, 0.25);
  add(new THREE.BoxGeometry(0.07, 0.07, 0.07), skin, 0.0, -0.08, -0.02);
  add(new THREE.BoxGeometry(0.07, 0.07, 0.28), sleeve, -0.13, -0.05, -L2 * 0.5 + 0.1);
  add(new THREE.BoxGeometry(0.07, 0.07, 0.07), skin, -0.05, -0.04, -L2 * 0.5);

  return { group, mag, muzzleZ: -L2 - b };
}
