import * as THREE from 'three';
import type { Rng } from '../core/rng';
import type { MapDef } from '../content/maps/types';
import type { Aabb, BoxId, CollisionWorld } from '../sim/collision';

export interface MapHandle {
  def: MapDef;
  // Removes the mesh of a breakable wall once the sim has broken it (the collider is removed by the sim).
  breakBox(id: BoxId): void;
  zones: { name: string; x: number; z: number }[];
  spawns: { x: number; z: number }[];
  crates: Footprint[];
  // Not in the phase 2 brief. The validator and gameplay code need them, so they are returned too.
  sandbags: Footprint[];
  barrels: { x: number; z: number; r: number; h: number }[];
  // Resupply crates (legacy `crates` array, index.html:1076-1084). Not colliders. Index i is sim crate i.
  pickups: { x: number; z: number }[];
  // Hides or shows a resupply crate (legacy k.mesh.visible, hidden during its cooldown).
  setCrateVisible(index: number, visible: boolean): void;
  dispose(): void;
}

// Centre and size of a placed prop. Same shape as the crates list in the brief.
export interface Footprint {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

// Building footprint. Legacy RECTS entry (index.html:776).
export interface BuildingRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

// index.html:789 roof trim is 0.6 m wider than the footprint, so the footprint is the roof inset by 0.3 m a side.
const ROOF_OVERHANG = 0.3;
// Legacy prop sizes and placement. index.html:757-759 (barrel), 1058 (sandbag), 1076-1084 (pickups).
const TRIES = 500;
const SANDBAG_H = 1.0;
const BARREL_R = 0.42;
const BARREL_H = 1.0;
const PICKUP_SIZE = 0.8;
const PICKUP_H = 0.5;
// index.html:1086-1090
const SPAWN_RING_R = 46;
const SPAWN_COUNT = 24;
const SPAWN_CLEARANCE = 1.5;
const TAU = Math.PI * 2;

function d2(ax: number, az: number, bx: number, bz: number): number {
  return (ax - bx) ** 2 + (az - bz) ** 2;
}

// Building footprints, recovered from the roof trim. One roof per building, so this matches the legacy RECTS list.
export function buildingRects(def: MapDef): BuildingRect[] {
  return def.roofs.map((r) => ({
    x0: r.min.x + ROOF_OVERHANG,
    z0: r.min.z + ROOF_OVERHANG,
    x1: r.max.x - ROOF_OVERHANG,
    z1: r.max.z - ROOF_OVERHANG,
  }));
}

// Builds a map: environment, colliders (registered in the world), wall and roof meshes, then props, pickups and
// spawns. Mirrors legacy buildMap (index.html:1033-1098). The rng is the only source of randomness.
// Boundary walls come from def.boxes, so they are not added again here.
export function buildMap(def: MapDef, scene: THREE.Scene, world: CollisionWorld, rng: Rng): MapHandle {
  const boxIds: BoxId[] = [];
  const objects: THREE.Object3D[] = [];
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const colliders: Aabb[] = [];
  const rects = buildingRects(def);

  const own = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const wallMat = own(new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.9 }));
  const woodMat = own(new THREE.MeshStandardMaterial({ color: 0xa98560, roughness: 0.9 }));
  const trimMat = own(new THREE.MeshStandardMaterial({ color: 0x5c6670, roughness: 0.7 }));
  const crateMat = own(new THREE.MeshStandardMaterial({ color: 0xc9a070, roughness: 0.85 }));
  const steelMat = own(new THREE.MeshStandardMaterial({ color: 0x7c828a, roughness: 0.55, metalness: 0.4 }));
  const sandMat = own(new THREE.MeshStandardMaterial({ color: 0xb49a6a, roughness: 1 }));
  const barrelMat = own(new THREE.MeshStandardMaterial({ color: 0x9b2a20, roughness: 0.5, metalness: 0.3 }));
  const pickupMat = own(
    new THREE.MeshStandardMaterial({ color: 0xe0b030, emissive: 0x4a3600, roughness: 0.6 }),
  );
  const groundMat = own(new THREE.MeshStandardMaterial({ color: def.ground, roughness: 1 }));

  const add = (o: THREE.Object3D): void => {
    scene.add(o);
    objects.push(o);
  };

  // A mesh whose geometry is tracked for dispose. The mesh is added to the scene.
  const addMesh = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    add(mesh);
    return mesh;
  };

  // Environment, as buildBoxes (render/boxes.ts) and legacy buildMap (index.html:1036-1041).
  scene.background = new THREE.Color(def.sky.horizon);
  scene.fog = new THREE.Fog(def.sky.horizon, def.fog[0], def.fog[1]);

  const hemi = new THREE.HemisphereLight(0xdfe8ff, def.ground, 0.9);
  add(hemi);

  const sun = new THREE.DirectionalLight(def.sun, 2.2);
  sun.position.set(40, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 220;
  add(sun);

  const ground = addMesh(new THREE.PlaneGeometry(240, 240), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;

  // Registers a collider in the world and in the local list used by the overlap test in areaFree.
  const collide = (box: Aabb, breakable: boolean): BoxId => {
    const id = world.add(box, { breakable });
    boxIds.push(id);
    colliders.push(box);
    return id;
  };

  // A box mesh sitting on min.y (as boxes.ts boxMesh).
  const addBoxMesh = (box: Aabb, mat: THREE.Material): THREE.Mesh => {
    const sx = box.max.x - box.min.x;
    const sy = box.max.y - box.min.y;
    const sz = box.max.z - box.min.z;
    const mesh = addMesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set((box.min.x + box.max.x) / 2, box.min.y + sy / 2, (box.min.z + box.max.z) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // Mesh of each breakable wall, by collider id, so breakBox can remove it once the sim breaks the wall.
  const breakMeshes = new Map<BoxId, THREE.Mesh>();
  // Map colliders in data order: boundary, buildings, cover (same order as legacy addBox calls).
  for (const b of def.boxes) {
    const id = collide(b, b.breakable);
    const mesh = addBoxMesh(b, b.breakable ? woodMat : wallMat);
    if (b.breakable) breakMeshes.set(id, mesh);
  }
  for (const r of def.roofs) addBoxMesh(r, trimMat);

  // Legacy areaFree (index.html:806-812).
  const areaFree = (x0: number, z0: number, x1: number, z1: number): boolean => {
    if (x1 > -8 && x0 < 8 && z1 > -8 && z0 < 8) return false;
    for (const zd of def.zones) {
      if (Math.hypot((x0 + x1) / 2 - zd.x, (z0 + z1) / 2 - zd.z) < 9) return false;
    }
    if (rects.some((q) => x0 < q.x1 && x1 > q.x0 && z0 < q.z1 && z1 > q.z0)) return false;
    for (const c of colliders) {
      if (c.min.x < x1 && c.max.x > x0 && c.min.z < z1 && c.max.z > z0) return false;
    }
    return true;
  };

  // Legacy openPoint (index.html:803-805).
  const openPoint = (x: number, z: number, r: number): boolean =>
    world.pointFree(x, z, r) &&
    !rects.some((q) => x > q.x0 - 0.5 && x < q.x1 + 0.5 && z > q.z0 - 0.5 && z < q.z1 + 0.5);

  // Sandbags (index.html:1053-1060).
  const sandbags: Footprint[] = [];
  for (let i = 0; i < TRIES && sandbags.length < def.sandbags; i++) {
    const horiz = rng.next() < 0.5;
    const len = 2.4 + rng.next() * 1.6;
    const x = -50 + rng.next() * 100;
    const z = -50 + rng.next() * 100;
    const x1 = horiz ? x + len : x + 0.9;
    const z1 = horiz ? z + 0.9 : z + len;
    if (!areaFree(x, z, x1, z1)) continue;
    const box: Aabb = { min: { x, y: 0, z }, max: { x: x1, y: SANDBAG_H, z: z1 } };
    collide(box, false);
    addBoxMesh(box, sandMat);
    sandbags.push({ x: (x + x1) / 2, z: (z + z1) / 2, w: x1 - x, d: z1 - z, h: SANDBAG_H });
  }

  // Barrels (index.html:1061-1066, addBarrel at 757-765). The collider is a square of half-size r * 0.9.
  const barrels: { x: number; z: number; r: number; h: number }[] = [];
  for (let i = 0; i < TRIES && barrels.length < def.barrels; i++) {
    const x = -50 + rng.next() * 100;
    const z = -50 + rng.next() * 100;
    if (!areaFree(x - 0.5, z - 0.5, x + 0.5, z + 0.5)) continue;
    const cr = BARREL_R * 0.9;
    collide({ min: { x: x - cr, y: 0, z: z - cr }, max: { x: x + cr, y: BARREL_H, z: z + cr } }, false);
    const mesh = addMesh(new THREE.CylinderGeometry(BARREL_R, BARREL_R, BARREL_H, 14), barrelMat);
    mesh.position.set(x, BARREL_H / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    barrels.push({ x, z, r: BARREL_R, h: BARREL_H });
  }

  // Prop crates (index.html:1067-1073). Footprint 1-3 m, height 0.9-1.6 m, steel 40 % of the time.
  const crates: Footprint[] = [];
  for (let i = 0; i < TRIES && crates.length < def.crates; i++) {
    const w = 1 + rng.next() * 2;
    const d = 1 + rng.next() * 2;
    const x = -52 + rng.next() * 104;
    const z = -52 + rng.next() * 104;
    if (!areaFree(x - w / 2 - 0.6, z - d / 2 - 0.6, x + w / 2 + 0.6, z + d / 2 + 0.6)) continue;
    const h = 0.9 + rng.next() * 0.7;
    const mat = rng.next() < 0.6 ? crateMat : steelMat;
    const box: Aabb = {
      min: { x: x - w / 2, y: 0, z: z - d / 2 },
      max: { x: x + w / 2, y: h, z: z + d / 2 },
    };
    collide(box, false);
    addBoxMesh(box, mat);
    crates.push({ x, z, w, d, h });
  }

  // Ammo pickups (index.html:1076-1084). Six, placed on open ground at least 12 m from every zone.
  const nearZone = (x: number, z: number): boolean => def.zones.some((zd) => d2(x, z, zd.x, zd.z) < 144);
  const pickups: { x: number; z: number }[] = [];
  const pickupMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    let x = 0;
    let z = 0;
    let t = 0;
    do {
      x = -45 + rng.next() * 90;
      z = -45 + rng.next() * 90;
      t++;
    } while ((!openPoint(x, z, 1.2) || nearZone(x, z)) && t < 300);
    const mesh = addMesh(new THREE.BoxGeometry(PICKUP_SIZE, PICKUP_H, PICKUP_SIZE), pickupMat);
    mesh.position.set(x, PICKUP_H / 2, z);
    mesh.castShadow = true;
    pickups.push({ x, z });
    pickupMeshes.push(mesh);
  }

  // Spawns on a ring (index.html:1086-1090). A fallback point is used only if every ring point is blocked.
  const spawns: { x: number; z: number }[] = [];
  for (let i = 0; i < SPAWN_COUNT; i++) {
    const a = (i / SPAWN_COUNT) * TAU;
    const x = Math.cos(a) * SPAWN_RING_R;
    const z = Math.sin(a) * SPAWN_RING_R;
    if (openPoint(x, z, SPAWN_CLEARANCE)) spawns.push({ x, z });
  }
  if (spawns.length === 0) spawns.push({ x: 0, z: SPAWN_RING_R });

  return {
    def,
    breakBox(id: BoxId): void {
      const mesh = breakMeshes.get(id);
      if (mesh === undefined) return;
      scene.remove(mesh);
      breakMeshes.delete(id);
    },
    zones: def.zones.map((z) => ({ name: z.name, x: z.x, z: z.z })),
    spawns,
    crates,
    sandbags,
    barrels,
    pickups,
    setCrateVisible(index: number, visible: boolean): void {
      const mesh = pickupMeshes[index];
      if (mesh !== undefined) mesh.visible = visible;
    },
    dispose(): void {
      for (const id of boxIds) world.remove(id);
      for (const o of objects) scene.remove(o);
      for (const g of geometries) g.dispose();
      sun.shadow.map?.dispose();
      for (const m of materials) m.dispose();
      scene.background = null;
      scene.fog = null;
    },
  };
}
