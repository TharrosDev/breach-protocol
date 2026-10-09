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
