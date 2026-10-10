// Gadget meshes: grenades, smoke clouds, the recon drone and the breach-charge marker. Geometry and
// materials follow index.html:1191-1195 (grenades), 1454-1466 (spawnSmoke, updSmoke), 1500-1529
// (launchDrone, updDrone) and 2063-2085 (plantCharge, updPlant). No DOM is touched at module load.
import * as THREE from 'three';
import type { Vec3 } from '../core/math';
import type { Rng } from '../core/rng';

export type GrenadeKind = 'frag' | 'enemyFrag' | 'flash' | 'smoke';

// index.html:1191. Shared by every grenade mesh.
let nadeGeometry: THREE.SphereGeometry | null = null;

// index.html:1192-1195. Created on first use and shared, so grenade meshes are never disposed.
const NADE_MATERIAL_PARAMS: Readonly<Record<GrenadeKind, THREE.MeshStandardMaterialParameters>> = {
  frag: { color: 0x3d5230, roughness: 0.6 },
  enemyFrag: { color: 0x7a2b22, roughness: 0.6 },
  flash: { color: 0xdfe6ee, emissive: 0x556070, roughness: 0.4 },
  smoke: { color: 0x9aa3ad, roughness: 0.6 },
};
const nadeMaterials: Partial<Record<GrenadeKind, THREE.MeshStandardMaterial>> = {};

function getNadeGeometry(): THREE.SphereGeometry {
  if (!nadeGeometry) nadeGeometry = new THREE.SphereGeometry(0.1, 10, 8);
  return nadeGeometry;
}

function getNadeMaterial(kind: GrenadeKind): THREE.MeshStandardMaterial {
  const cached = nadeMaterials[kind];
  if (cached) return cached;
  const mat = new THREE.MeshStandardMaterial(NADE_MATERIAL_PARAMS[kind]);
  nadeMaterials[kind] = mat;
  return mat;
}

// A new mesh per call; the geometry and material are shared between calls.
export function grenadeMesh(kind: GrenadeKind): THREE.Mesh {
  return new THREE.Mesh(getNadeGeometry(), getNadeMaterial(kind));
}

// index.html:1454-1466. Shared sphere geometry, unit radius, scaled per puff.
let puffGeometry: THREE.SphereGeometry | null = null;
const SMOKE_COLOUR = 0xc2c8d0;
export const SMOKE_OPACITY = 0.55;
const SMOKE_PUFFS = 7;

function getPuffGeometry(): THREE.SphereGeometry {
  if (!puffGeometry) puffGeometry = new THREE.SphereGeometry(1, 14, 10);
  return puffGeometry;
}

export interface SmokeCloud {
  group: THREE.Group;
  // Sets the shared puff opacity. updSmoke in the legacy game passes 0.55 * min(1, t / 2).
  setOpacity(opacity: number): void;
  // Removes the group from the scene and disposes the cloud's material.
  dispose(): void;
}

// Builds a cluster of seven puffs at pos. The rng decides scale and offset, so a seeded stream gives a
// repeatable cloud. The caller owns the fade timer.
export function smokeCloud(scene: THREE.Scene, pos: Vec3, rng: Rng): SmokeCloud {
  const mat = new THREE.MeshBasicMaterial({
    color: SMOKE_COLOUR,
    transparent: true,
    opacity: SMOKE_OPACITY,
    depthWrite: false,
  });
  const geo = getPuffGeometry();
  const group = new THREE.Group();
  group.position.set(pos.x, pos.y, pos.z);
  for (let i = 0; i < SMOKE_PUFFS; i++) {
    const puff = new THREE.Mesh(geo, mat);
    puff.scale.setScalar(1.6 + rng.next() * 1.2);
    puff.position.set((rng.next() - 0.5) * 3, rng.next() * 1.2 - 0.6, (rng.next() - 0.5) * 3);
    group.add(puff);
  }
  scene.add(group);

  return {
    group,
    setOpacity(opacity: number): void {
      mat.opacity = opacity;
    },
    dispose(): void {
      scene.remove(group);
      mat.dispose();
    },
  };
}

// index.html:1500-1517. Rotor offsets in the body's local x and z.
const ROTOR_OFFSETS: readonly (readonly [number, number])[] = [
  [-0.35, -0.35],
  [0.35, -0.35],
  [-0.35, 0.35],
  [0.35, 0.35],
];
const DRONE_SPIN_RATE = 12;

export interface DroneModel {
  group: THREE.Group;
  // Spins the drone about y. index.html:1529 (rotation.y += dt * 12).
  spin(dt: number): void;
  setPos(x: number, y: number, z: number): void;
  // Removes the group from its parent and disposes its geometry and materials.
  dispose(): void;
}

// The caller adds group to the scene and moves it along its flight path.
export function droneModel(): DroneModel {
  const bodyGeo = new THREE.BoxGeometry(0.5, 0.12, 0.5);
  const rotorGeo = new THREE.BoxGeometry(0.3, 0.03, 0.3);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.6 });
  const rotorMat = new THREE.MeshBasicMaterial({ color: 0x58b7ff });

  const group = new THREE.Group();
  group.add(new THREE.Mesh(bodyGeo, bodyMat));
  for (const [x, z] of ROTOR_OFFSETS) {
    const rotor = new THREE.Mesh(rotorGeo, rotorMat);
    rotor.position.set(x, 0.08, z);
    group.add(rotor);
  }

  return {
    group,
    spin(dt: number): void {
      group.rotation.y += dt * DRONE_SPIN_RATE;
    },
    setPos(x: number, y: number, z: number): void {
      group.position.set(x, y, z);
    },
    dispose(): void {
      group.removeFromParent();
      bodyGeo.dispose();
      rotorGeo.dispose();
      bodyMat.dispose();
      rotorMat.dispose();
    },
  };
}

// index.html:2063-2085. A small box at the breach point. Flashes red while the charge is armed.
const BREACH_ON = 0xff2020;
const BREACH_OFF = 0x4a0a0a;
const BREACH_FLASH_RATE = 18;

export interface BreachMarker {
  setPosition(p: Vec3): void;
  // Red while sin(time * 18) > 0, dark red otherwise. Writes the colour only when it changes.
  flash(time: number): void;
  // Removes the mesh from the scene and disposes its geometry and material.
  dispose(): void;
}

export function breachMarker(scene: THREE.Scene): BreachMarker {
  const geo = new THREE.BoxGeometry(0.3, 0.3, 0.12);
  const mat = new THREE.MeshBasicMaterial({ color: BREACH_ON });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  let colour = BREACH_ON;

  return {
    setPosition(p: Vec3): void {
      mesh.position.set(p.x, p.y, p.z);
    },
    flash(time: number): void {
      const want = Math.sin(time * BREACH_FLASH_RATE) > 0 ? BREACH_ON : BREACH_OFF;
      if (want === colour) return;
      colour = want;
      mat.color.setHex(want);
    },
    dispose(): void {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}

// Claymore mine: an olive curved body on two spiked legs, a ribbed front face, a top sight and a status lamp. The lamp
// blinks amber while the mine arms and glows steady red once armed. Geometry and the body materials are shared, and each
// mine owns only its lamp material, so a field of mines costs a few draw calls.
const CLAYMORE_ARMING = 0xffb020;
const CLAYMORE_ARMED = 0xff2a2a;
let claymoreParts: {
  body: THREE.BufferGeometry;
  face: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  sight: THREE.BufferGeometry;
  lamp: THREE.BufferGeometry;
  bodyMat: THREE.Material;
  faceMat: THREE.Material;
  legMat: THREE.Material;
} | null = null;

function getClaymoreParts(): NonNullable<typeof claymoreParts> {
  if (claymoreParts) return claymoreParts;
  claymoreParts = {
    body: new THREE.BoxGeometry(0.4, 0.17, 0.07),
    face: new THREE.BoxGeometry(0.36, 0.13, 0.03),
    leg: new THREE.CylinderGeometry(0.008, 0.008, 0.14, 5),
    sight: new THREE.BoxGeometry(0.1, 0.03, 0.03),
    lamp: new THREE.SphereGeometry(0.018, 8, 6),
    bodyMat: new THREE.MeshStandardMaterial({ color: 0x4a5a32, roughness: 0.75 }),
    faceMat: new THREE.MeshStandardMaterial({ color: 0x2c3620, roughness: 0.6, metalness: 0.2 }),
    legMat: new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.6, metalness: 0.5 }),
  };
  return claymoreParts;
}

export interface ClaymoreModel {
  group: THREE.Group;
  // Blinks the lamp amber while arming and holds it red once armed.
  update(armT: number, time: number): void;
  dispose(): void;
}

// Facing is the direction the mine throws its blast, as a yaw from +z (the player's aim when it was set).
export function claymoreModel(x: number, z: number, yaw: number): ClaymoreModel {
  const parts = getClaymoreParts();
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;

  const body = new THREE.Mesh(parts.body, parts.bodyMat);
  body.position.set(0, 0.13, 0);
  const face = new THREE.Mesh(parts.face, parts.faceMat);
  face.position.set(0, 0.13, 0.05);
  const sight = new THREE.Mesh(parts.sight, parts.legMat);
  sight.position.set(0, 0.23, 0);
  group.add(body, face, sight);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(parts.leg, parts.legMat);
    leg.position.set(side * 0.14, 0.06, 0.02);
    leg.rotation.set(0.35, 0, side * 0.3);
    group.add(leg);
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: CLAYMORE_ARMING });
  const lamp = new THREE.Mesh(parts.lamp, lampMat);
  lamp.position.set(0.13, 0.225, -0.01);
  group.add(lamp);

  let colour = CLAYMORE_ARMING;
  return {
    group,
    update(armT: number, time: number): void {
      const want = armT > 0 ? (Math.sin(time * 14) > 0 ? CLAYMORE_ARMING : 0x4a3208) : CLAYMORE_ARMED;
      if (want === colour) return;
      colour = want;
      lampMat.color.setHex(want);
    },
    dispose(): void {
      group.removeFromParent();
      lampMat.dispose();
    },
  };
}
