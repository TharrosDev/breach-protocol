// Procedural humanoid models for enemies and operators. Each kind has its own silhouette: the rifleman has a
// helmet with goggles, a plate carrier and a small pack; the heavy has a full-face helmet, shoulder armour and a
// riot shield with a viewport; the sniper has a boonie hat, a face wrap, ghillie strips and a scoped rifle with a
// bipod; the grenadier has a gas mask, a grenade bandolier and a pack with launcher tubes; operators wear a cap,
// goggles and a glowing friendly armband.
//
// Static detail is merged into a few meshes per segment and cached per kind and colour, so a squad of bodies costs
// a handful of draw calls each. Limbs are pivot groups: thigh and shin, upper arm and forearm.
//
// Animation: animateHuman drives the walk cycle (hips, knees, shoulders, elbows, torso counter-twist, breathing).
// placeHumanEnemy places the body, plays the hit flinch, the cover crouch and a ragdoll-ish death fall.
// No DOM is touched here: the caller adds the group to the scene.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ENEMY_DEFS, type EnemyKindId } from '../content/enemies';

const TAU = Math.PI * 2;
const MARK_COLOUR = 0xff3b3b;
const FLASH_COLOUR = 0xffe9e0;
const FLASH_SECONDS = 0.09;
// The upper-arm and forearm length, and the thigh and shin length.
const SHOULDER_Y = 1.42;
const HIP_Y = 0.8;

export interface HumanRig {
  group: THREE.Group;
  // Leg pivots: [left, right]. Each is a hip pivot whose first child is the thigh.
  legs: THREE.Object3D[];
  // Arm pivots: [left, right]. Each is a shoulder pivot.
  arms: THREE.Object3D[];
  // Knee and elbow pivots: [left, right].
  shins: THREE.Object3D[];
  forearms: THREE.Object3D[];
  // Torso, head and everything carried on them. Twists and leans with the gait.
  upper: THREE.Object3D;
  head: THREE.Object3D;
  // Red octahedron above the head, shown while the enemy has spotted the player.
  marker: THREE.Object3D;
  // Rifle or sniper rifle held by the right arm.
  gun: THREE.Object3D;
  // Local z of the gun at rest, the recoil offset is taken from this.
  baseGunZ: number;
  // Forward lean (radians) of the body while moving. Rushers run hunched forward.
  lean: number;
  // Hit-flash and death bookkeeping. Render side only.
  flashT: number;
  deadT: number;
  clock: number;
  body: BodyMesh[];
  flashing: boolean;
}

interface BodyMesh {
  mesh: THREE.Mesh;
  material: THREE.Material | THREE.Material[];
}

export interface HumanAnimState {
  phase: number;
  moving: boolean;
  aiming: boolean;
}

// Render-side view of one body. fall, kick and crouch are render-only and are updated in place.
// flinchT and hiding come from the sim (the flinch timer and cover state).
export interface HumanPlaceState {
  x: number;
  z: number;
  yaw: number;
  // Gun recoil. Decays at dt * 8 and is written back to the state.
  kick: number;
  // Cover crouch, lerped toward hiding ? 1 : 0 and written back to the state.
  crouch: number;
  hiding: boolean;
  // Remaining time of the hit flinch (sim-owned, read only). Pushes the body back by flinchT * 2.5.
  flinchT: number;
  // Spotted timer. The marker is shown while it is above zero.
  spot: number;
  phase: number;
  moving: boolean;
  alive: boolean;
  // Death fall progress, 0 to 1. Advanced in place while the body is dead.
  fall: number;
  tumble: -1 | 1;
  time: number;
  dt: number;
}

type Style = 'rifle' | 'heavy' | 'sniper' | 'grenadier' | 'operator';

interface KindFlags {
  heavy: boolean;
  sniper: boolean;
  grenadier: boolean;
}

// Operators reuse the rifleman's proportions.
function flagsFor(kind: EnemyKindId | 'operator'): KindFlags {
  if (kind === 'operator') return { heavy: false, sniper: false, grenadier: false };
  const def = ENEMY_DEFS[kind];
  return { heavy: def.heavy, sniper: def.sniper, grenadier: def.grenadier };
}

function styleFor(kind: EnemyKindId | 'operator'): Style {
  if (kind === 'operator') return 'operator';
  const f = flagsFor(kind);
  if (f.heavy) return 'heavy';
  if (f.sniper) return 'sniper';
  if (f.grenadier) return 'grenadier';
  return 'rifle';
}

// A stable hash of a kind id, used to give kinds nobody drew by hand their own accent colour.
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared geometry and materials

const geometries = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometries.get(key);
  if (!g) {
    g = make();
    geometries.set(key, g);
  }
  return g;
}

const materials = new Map<string, THREE.Material>();
function mat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = materials.get(key);
  if (!m) {
    m = make();
    materials.set(key, m);
  }
  return m as T;
}

function shade(colour: number, k: number): number {
  const c = new THREE.Color(colour);
  c.multiplyScalar(k);
  return c.getHex();
}

interface Palette {
  cloth: THREE.MeshStandardMaterial;
  pants: THREE.MeshStandardMaterial;
  vest: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  strap: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  ghillie: THREE.MeshStandardMaterial;
  helmet: THREE.MeshStandardMaterial;
  // Medic cross: a white plate and a red cross.
  medWhite: THREE.MeshStandardMaterial;
  medRed: THREE.MeshStandardMaterial;
}

function palette(kind: EnemyKindId | 'operator', colour: number): Palette {
  const key = `${kind}:${String(colour)}`;
  const accentHue = (hashString(kind) % 360) / 360;
  const accentColour =
    kind === 'operator' ? 0x58b7ff : new THREE.Color().setHSL(accentHue, 0.7, 0.5).getHex();
  return {
    cloth: mat(
      `cloth:${String(colour)}`,
      () => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.88 }),
    ),
    pants: mat(
      `pants:${String(colour)}`,
      () => new THREE.MeshStandardMaterial({ color: shade(colour, 0.72), roughness: 0.92 }),
    ),
    vest: mat(
      `vest:${String(colour)}`,
      () => new THREE.MeshStandardMaterial({ color: shade(0x2a2620, 1), roughness: 0.95 }),
    ),
    dark: mat(
      'dark',
      () => new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.7, metalness: 0.15 }),
    ),
    strap: mat('strap', () => new THREE.MeshStandardMaterial({ color: 0x14130f, roughness: 0.95 })),
    skin: mat('skin', () => new THREE.MeshStandardMaterial({ color: 0xc9a77f, roughness: 0.8 })),
    metal: mat(
      'hmetal',
      () => new THREE.MeshStandardMaterial({ color: 0x555b63, roughness: 0.45, metalness: 0.7 }),
    ),
    glass: mat(
      `glass:${key}`,
      () =>
        new THREE.MeshStandardMaterial({
          color: 0x0a1218,
          roughness: 0.1,
          metalness: 0.3,
          emissive: kind === 'operator' ? 0x2a7bff : 0xffa030,
          emissiveIntensity: 0.7,
        }),
    ),
    accent: mat(
      `accent:${String(accentColour)}`,
      () =>
        new THREE.MeshStandardMaterial({
          color: accentColour,
          roughness: 0.6,
          emissive: accentColour,
          emissiveIntensity: kind === 'operator' ? 1.1 : 0.25,
        }),
    ),
    glow: mat(
      'hglow',
      () => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3b3b, emissiveIntensity: 1.4 }),
    ),
    ghillie: mat(
      `ghillie:${String(colour)}`,
      () => new THREE.MeshStandardMaterial({ color: shade(colour, 1.25), roughness: 1 }),
    ),
    medWhite: mat(
      'medwhite',
      () => new THREE.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.6, emissive: 0x303a40 }),
    ),
    medRed: mat(
      'medred',
      () => new THREE.MeshStandardMaterial({ color: 0xd62d2d, roughness: 0.5, emissive: 0x7a1010 }),
    ),
    helmet: mat(
      `helmet:${String(colour)}`,
      () => new THREE.MeshStandardMaterial({ color: shade(colour, 0.6), roughness: 0.55, metalness: 0.2 }),
    ),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A tiny builder that collects primitives by material and merges them into one geometry per material.

class Parts {
  private readonly bucket = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  private push(
    g: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    sx = 1,
    sy = 1,
    sz = 1,
  ): void {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.p.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.m.compose(this.p, this.q, this.s);
    g.applyMatrix4(this.m);
    const list = this.bucket.get(material);
    if (list) list.push(g);
    else this.bucket.set(material, [g]);
  }

  box(
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): this {
    this.push(new THREE.BoxGeometry(w, h, d), material, x, y, z, rx, ry, rz);
    return this;
  }

  sphere(r: number, material: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): this {
    this.push(new THREE.SphereGeometry(r, 10, 8), material, x, y, z, 0, 0, 0, sx, sy, sz);
    return this;
  }

  dome(r: number, material: THREE.Material, x: number, y: number, z: number, sy = 1): this {
    this.push(
      new THREE.SphereGeometry(r, 12, 8, 0, TAU, 0, Math.PI / 2),
      material,
      x,
      y,
      z,
      0,
      0,
      0,
      1,
      sy,
      1,
    );
    return this;
  }

  // Cylinder along y unless rotated.
  cyl(
    r0: number,
    r1: number,
    h: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    seg = 10,
  ): this {
    this.push(new THREE.CylinderGeometry(r0, r1, h, seg), material, x, y, z, rx, ry, rz);
    return this;
  }

  // Merged meshes, one per material.
  meshes(): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
    const out: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    for (const [material, list] of this.bucket) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      out.push({ geometry: merged, material });
    }
    return out;
  }
}

const merged = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material }[]>();
function segment(
  key: string,
  build: (p: Parts) => void,
): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  let list = merged.get(key);
  if (!list) {
    const parts = new Parts();
    build(parts);
    list = parts.meshes();
    merged.set(key, list);
  }
  return list;
}

function attach(
  parent: THREE.Object3D,
  list: { geometry: THREE.BufferGeometry; material: THREE.Material }[],
  rig: BodyMesh[],
  shadow = true,
): void {
  for (const { geometry, material } of list) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadow;
    parent.add(mesh);
    rig.push({ mesh, material });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Segment recipes

function upperDetail(p: Parts, style: Style, kind: string, k: Palette, tw: number): void {
  // Neck and head.
  p.cyl(0.07, 0.08, 0.1, k.skin, 0, 1.5, 0);
  p.sphere(0.19, k.skin, 0, 1.6, 0, 1, 1.05, 1);
  // Plate carrier and belt.
  p.box(tw + 0.08, 0.5, 0.48, k.vest, 0, 1.14, 0.02);
  p.box(tw + 0.1, 0.07, 0.5, k.strap, 0, 0.82, 0.02);
  p.box(0.12, 0.22, 0.08, k.dark, 0.3, 0.78, 0.0);
  // Shoulder straps and collar.
  p.box(0.12, 0.06, 0.5, k.vest, -tw / 2 + 0.05, 1.46, 0.0);
  p.box(0.12, 0.06, 0.5, k.vest, tw / 2 - 0.05, 1.46, 0.0);

  if (style === 'rifle') {
    // Helmet with a rim, chinstrap, NVG mount and goggles.
    p.dome(0.22, k.helmet, 0, 1.62, 0, 1);
    p.box(0.46, 0.035, 0.46, k.helmet, 0, 1.63, 0);
    p.box(0.06, 0.1, 0.06, k.metal, 0, 1.72, 0.2);
    p.box(0.3, 0.08, 0.04, k.glass, 0, 1.6, 0.185);
    p.box(0.34, 0.03, 0.05, k.strap, 0, 1.655, 0.18);
    p.box(0.03, 0.14, 0.03, k.strap, -0.19, 1.52, 0.04);
    p.box(0.03, 0.14, 0.03, k.strap, 0.19, 1.52, 0.04);
    // Mag pouches, radio and patch.
    for (let i = -1; i <= 1; i++) p.box(0.1, 0.15, 0.07, k.dark, i * 0.14, 1.02, 0.29);
    p.box(0.07, 0.2, 0.07, k.metal, -tw / 2 - 0.02, 1.42, -0.1);
    p.box(0.01, 0.2, 0.01, k.metal, -tw / 2 - 0.02, 1.62, -0.1);
    p.box(0.14, 0.1, 0.02, k.accent, 0, 1.3, 0.29);
    // Small assault pack.
    p.box(0.38, 0.4, 0.2, k.cloth, 0, 1.2, -0.32);
    p.box(0.3, 0.1, 0.12, k.dark, 0, 1.36, -0.34);
  } else if (style === 'operator') {
    // Cap with a brim, tinted goggles and a glowing friendly armband.
    p.dome(0.21, k.helmet, 0, 1.63, -0.005, 0.9);
    p.box(0.3, 0.03, 0.14, k.helmet, 0, 1.64, 0.2);
    p.box(0.32, 0.075, 0.035, k.glass, 0, 1.585, 0.188);
    p.box(0.34, 0.03, 0.04, k.strap, 0, 1.55, 0.0);
    for (let i = -1; i <= 1; i++) p.box(0.1, 0.15, 0.07, k.dark, i * 0.14, 1.02, 0.29);
    p.box(0.16, 0.13, 0.03, k.accent, 0, 1.3, 0.29);
    p.box(0.07, 0.2, 0.07, k.metal, tw / 2 + 0.02, 1.42, -0.1);
    p.box(0.36, 0.34, 0.2, k.cloth, 0, 1.2, -0.31);
    // Friendly marker lamp on the back so a squadmate reads at range.
    p.box(0.12, 0.05, 0.02, k.accent, 0, 1.38, -0.43);
  } else if (style === 'heavy') {
    // Full-face helmet with a slit visor, jaw guard and ear cups.
    p.dome(0.24, k.helmet, 0, 1.63, 0, 1.05);
    p.box(0.42, 0.18, 0.4, k.helmet, 0, 1.55, 0);
    p.box(0.3, 0.05, 0.05, k.glass, 0, 1.58, 0.205);
    p.box(0.3, 0.1, 0.06, k.dark, 0, 1.48, 0.2);
    p.box(0.06, 0.16, 0.14, k.dark, -0.23, 1.58, 0.0);
    p.box(0.06, 0.16, 0.14, k.dark, 0.23, 1.58, 0.0);
    // Chest plate, shoulder pads, groin guard and a back plate.
    p.box(tw - 0.1, 0.4, 0.06, k.helmet, 0, 1.2, 0.29);
    p.box(0.3, 0.12, 0.34, k.helmet, -tw / 2 - 0.04, 1.47, 0);
    p.box(0.3, 0.12, 0.34, k.helmet, tw / 2 + 0.04, 1.47, 0);
    p.box(0.26, 0.2, 0.05, k.helmet, 0, 0.7, 0.2);
    p.box(tw - 0.1, 0.5, 0.08, k.helmet, 0, 1.15, -0.28);
    p.box(0.12, 0.08, 0.02, k.accent, 0, 1.38, 0.33);
  } else if (style === 'sniper') {
    // Boonie hat, face wrap, ghillie strips and a hip pouch.
    p.cyl(0.3, 0.3, 0.025, k.ghillie, 0, 1.69, 0, 0, 0, 0, 14);
    p.dome(0.2, k.ghillie, 0, 1.69, 0, 0.9);
    p.box(0.34, 0.14, 0.34, k.cloth, 0, 1.52, 0.0);
    p.box(0.3, 0.05, 0.04, k.glass, 0, 1.6, 0.185);
    for (let i = 0; i < 22; i++) {
      const a = Math.sin(i * 12.9898 + 1.7) * 43758.5453;
      const r1 = a - Math.floor(a);
      const a2 = Math.sin(i * 78.233 + 3.1) * 43758.5453;
      const r2 = a2 - Math.floor(a2);
      const x = (r1 - 0.5) * (tw + 0.2);
      const y = 1.5 + r2 * 0.12 - (i % 3) * 0.1;
      p.box(
        0.035,
        0.22 + r2 * 0.14,
        0.035,
        k.ghillie,
        x,
        y,
        0.1 + ((i * 7) % 5) * 0.06 - 0.12,
        0,
        i,
        0.2 * (r1 - 0.5),
      );
    }
    p.box(0.1, 0.14, 0.12, k.dark, tw / 2 + 0.02, 0.78, 0.0);
    p.box(0.1, 0.14, 0.12, k.dark, -tw / 2 - 0.02, 0.78, 0.0);
    p.box(0.34, 0.5, 0.18, k.dark, 0, 1.22, -0.32);
  } else {
    // Grenadier: gas mask with twin lenses and a filter, a bandolier of grenades and a launcher pack.
    p.dome(0.22, k.helmet, 0, 1.63, 0, 1);
    p.box(0.26, 0.2, 0.08, k.dark, 0, 1.56, 0.2);
    p.cyl(0.05, 0.05, 0.1, k.metal, 0, 1.5, 0.28, Math.PI / 2, 0, 0);
    p.cyl(0.045, 0.045, 0.02, k.glass, -0.08, 1.6, 0.245, Math.PI / 2, 0, 0);
    p.cyl(0.045, 0.045, 0.02, k.glass, 0.08, 1.6, 0.245, Math.PI / 2, 0, 0);
    // Bandolier across the chest with grenades.
    p.box(0.12, 0.7, 0.04, k.strap, 0, 1.15, 0.27, 0, 0, 0.6);
    for (let i = 0; i < 4; i++) {
      p.sphere(0.055, k.accent, -0.2 + i * 0.13, 1.35 - i * 0.14, 0.31);
      p.box(0.03, 0.03, 0.03, k.metal, -0.2 + i * 0.13, 1.4 - i * 0.14, 0.31);
    }
    // Pack with two launcher tubes.
    p.box(0.46, 0.52, 0.22, k.dark, 0, 1.15, -0.33);
    p.cyl(0.06, 0.06, 0.6, k.metal, -0.14, 1.2, -0.5, Math.PI / 2 - 0.15, 0, 0);
    p.cyl(0.06, 0.06, 0.6, k.metal, 0.14, 1.2, -0.5, Math.PI / 2 - 0.15, 0, 0);
    p.box(0.2, 0.2, 0.08, k.glow, 0, 1.0, -0.46);
  }
  if (kind === 'medic') medicAccents(p, k, tw);
  if (kind === 'rusher') rusherAccents(p, k, tw);
  // A small kind-coloured shoulder patch distinguishes kinds that share a silhouette.
  p.box(0.01, 0.1, 0.1, k.accent, -tw / 2 - 0.085, 1.34, 0);
  if (kind === 'operator') p.box(0.01, 0.1, 0.1, k.accent, tw / 2 + 0.085, 1.34, 0);
}

// Medic: a white backpack with a red cross, a cross on the chest and on each side of the helmet.
function cross(p: Parts, k: Palette, size: number, x: number, y: number, z: number, ry: number): void {
  const t = size * 0.32;
  p.box(size, size, 0.02, k.medWhite, x, y, z, 0, ry, 0);
  p.box(size * 0.8, t, 0.03, k.medRed, x, y, z, 0, ry, 0);
  p.box(t, size * 0.8, 0.03, k.medRed, x, y, z, 0, ry, 0);
}

function medicAccents(p: Parts, k: Palette, tw: number): void {
  // The assault pack becomes a medical pack.
  p.box(0.42, 0.46, 0.24, k.medWhite, 0, 1.2, -0.34);
  cross(p, k, 0.3, 0, 1.2, -0.47, 0);
  // Chest cross, above the pouches.
  cross(p, k, 0.18, -0.13, 1.28, 0.3, 0);
  // Helmet side crosses.
  cross(p, k, 0.12, -0.225, 1.66, 0.0, Math.PI / 2);
  cross(p, k, 0.12, 0.225, 1.66, 0.0, Math.PI / 2);
  // A satchel on the hip.
  p.box(0.12, 0.16, 0.2, k.medWhite, tw / 2 + 0.04, 0.84, 0.05);
  p.box(0.13, 0.05, 0.08, k.medRed, tw / 2 + 0.045, 0.84, 0.05);
}

// Rusher: a headband with trailing tails, a taped forearm wrap and a stripped-down rig (no pack).
function rusherAccents(p: Parts, k: Palette, tw: number): void {
  p.box(0.44, 0.05, 0.44, k.accent, 0, 1.69, 0);
  p.box(0.05, 0.05, 0.3, k.accent, 0.1, 1.64, -0.3, 0.5, 0, 0);
  p.box(0.05, 0.05, 0.26, k.accent, -0.1, 1.62, -0.28, 0.7, 0, 0);
  // Cover the shoulder pack with a flat cloth sheet so the silhouette is lean.
  p.box(0.4, 0.42, 0.04, k.cloth, 0, 1.2, -0.43);
  p.box(0.1, 0.04, 0.4, k.accent, tw / 2 + 0.02, 1.26, 0.0);
}

function thighDetail(p: Parts, style: Style, k: Palette, side: number): void {
  p.box(0.21, 0.42, 0.24, k.pants, 0, -0.21, 0);
  p.box(0.07, 0.16, 0.1, k.dark, side * 0.12, -0.16, 0.0);
  if (style === 'heavy') p.box(0.24, 0.2, 0.27, k.helmet, 0, -0.2, 0.01);
  if (style === 'grenadier') p.box(0.1, 0.12, 0.12, k.dark, side * 0.12, -0.3, 0.0);
}

function shinDetail(p: Parts, style: Style, k: Palette): void {
  p.box(0.18, 0.4, 0.2, k.pants, 0, -0.2, 0);
  p.box(0.2, 0.12, 0.3, k.dark, 0, -0.35, 0.05);
  p.box(0.2, 0.05, 0.1, k.strap, 0, -0.39, 0.16);
  p.box(0.16, 0.14, 0.04, k.dark, 0, -0.06, 0.12);
  if (style === 'heavy') p.box(0.2, 0.26, 0.06, k.helmet, 0, -0.17, 0.12);
}

function upperArmDetail(p: Parts, style: Style, k: Palette): void {
  p.box(0.15, 0.32, 0.17, k.cloth, 0, -0.16, 0);
  if (style === 'heavy') p.box(0.18, 0.16, 0.2, k.helmet, 0, -0.1, 0);
}

function forearmDetail(p: Parts, k: Palette): void {
  p.box(0.13, 0.32, 0.15, k.cloth, 0, -0.16, 0);
  p.box(0.11, 0.1, 0.12, k.dark, 0, -0.36, 0);
  p.box(0.15, 0.06, 0.17, k.strap, 0, -0.04, 0);
}

function gunDetail(p: Parts, style: Style, k: Palette, depth: number): void {
  // The gun mesh itself is the receiver box; these are the extras around it, in its local space.
  const front = -depth / 2;
  const back = depth / 2;
  p.box(0.07, 0.14, 0.1, k.dark, 0, -0.12, front * 0.1);
  p.box(0.1, 0.18, 0.18, k.dark, 0, -0.04, back + 0.07);
  p.box(0.08, 0.08, 0.14, k.dark, 0, -0.1, back - 0.1);
  p.box(0.04, 0.035, 0.04, k.metal, 0, 0.085, front * 0.8);
  p.box(0.04, 0.035, 0.04, k.metal, 0, 0.085, back * 0.5);
  p.box(0.05, 0.05, 0.12, k.metal, 0, 0.0, front - 0.05);
  if (style === 'sniper') {
    p.cyl(0.035, 0.035, 0.3, k.metal, 0, 0.13, -0.05, Math.PI / 2, 0, 0, 12);
    p.cyl(0.05, 0.04, 0.08, k.dark, 0, 0.13, -0.22, Math.PI / 2, 0, 0, 12);
    p.box(0.018, 0.018, 0.06, k.glass, 0, 0.13, -0.27);
    p.box(0.014, 0.12, 0.014, k.metal, -0.04, -0.08, front + 0.1, 0.4, 0, 0);
    p.box(0.014, 0.12, 0.014, k.metal, 0.04, -0.08, front + 0.1, 0.4, 0, 0);
    p.box(0.06, 0.06, 0.2, k.dark, 0, -0.01, front * 0.3);
  } else if (style === 'grenadier') {
    p.cyl(0.04, 0.045, 0.2, k.metal, 0, -0.06, front + 0.1, Math.PI / 2, 0, 0);
    p.box(0.05, 0.1, 0.05, k.dark, 0, -0.1, front * 0.4);
  } else if (style === 'heavy') {
    p.box(0.14, 0.14, 0.18, k.dark, 0, -0.13, front * 0.1);
    p.box(0.12, 0.05, 0.3, k.metal, 0, 0.07, front * 0.2);
  } else {
    p.box(0.045, 0.045, 0.2, k.metal, 0, 0.07, front * 0.1);
    p.box(0.03, 0.025, 0.1, k.glass, 0, 0.12, -0.02);
  }
}

// ---------------------------------------------------------------------------------------------------------------

let markGeometry: THREE.BufferGeometry | null = null;
let markMaterial: THREE.MeshBasicMaterial | null = null;
function markerParts(): { geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial } {
  if (!markGeometry) markGeometry = new THREE.OctahedronGeometry(0.14);
  if (!markMaterial) markMaterial = new THREE.MeshBasicMaterial({ color: MARK_COLOUR });
  return { geometry: markGeometry, material: markMaterial };
}

const flashMaterial = new THREE.MeshBasicMaterial({ color: FLASH_COLOUR });

function pivot(x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}

// Builds one body. kind 'operator' uses the rifleman proportions with the given colour.
export function makeHumanRig(kind: EnemyKindId | 'operator', colour: number): HumanRig {
  const flags = flagsFor(kind);
  const style = styleFor(kind);
  const k = palette(kind, colour);
  const tw = flags.heavy ? 0.8 : 0.52;
  const ck = `${kind}:${String(colour)}`;
  const body: BodyMesh[] = [];

  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  // Big hostiles (the juggernaut) are scaled up; placeHumanEnemy keeps this base when it crouches the body.
  const baseScale = kind === 'operator' ? 1 : ENEMY_DEFS[kind].scale;
  group.userData.baseScale = baseScale;
  group.scale.setScalar(baseScale);

  // Upper body pivot: torso, head and carried gear.
  const upper = new THREE.Group();
  group.add(upper);

  const torso = new THREE.Mesh(
    geo(`torso:${String(tw)}`, () => new THREE.BoxGeometry(tw, 0.75, 0.42)),
    k.cloth,
  );
  torso.position.y = 1.12;
  torso.castShadow = true;
  upper.add(torso);
  body.push({ mesh: torso, material: k.cloth });
  attach(
    upper,
    segment(`upper:${ck}`, (p) => {
      upperDetail(p, style, kind, k, tw);
    }),
    body,
  );

  // Head pivot marker for the death loll and hit reaction (no mesh of its own: the head is part of the upper detail).
  const head = pivot(0, 1.55, 0);
  upper.add(head);

  // Gun.
  const gunDepth = flags.sniper ? 1.1 : 0.75;
  const gun = new THREE.Mesh(
    geo(`gun:${String(gunDepth)}`, () => new THREE.BoxGeometry(0.11, 0.12, gunDepth)),
    k.dark,
  );
  const baseGunZ = flags.sniper ? 0.5 : 0.4;
  gun.position.set(0.24, 1.22, baseGunZ);
  gun.castShadow = true;
  upper.add(gun);
  body.push({ mesh: gun, material: k.dark });
  attach(
    gun,
    segment(`gun:${style}:${ck}`, (p) => {
      gunDetail(p, style, k, gunDepth);
    }),
    body,
    false,
  );

  // Arms: shoulder pivot -> upper arm -> elbow pivot -> forearm and hand.
  const arms: THREE.Object3D[] = [];
  const forearms: THREE.Object3D[] = [];
  for (const x of [-1, 1]) {
    const shoulder = pivot(x * (tw / 2 + 0.08), SHOULDER_Y, 0);
    attach(
      shoulder,
      segment(`uarm:${style}:${ck}`, (p) => {
        upperArmDetail(p, style, k);
      }),
      body,
    );
    const elbow = pivot(0, -0.32, 0);
    attach(
      elbow,
      segment(`farm:${ck}`, (p) => {
        forearmDetail(p, k);
      }),
      body,
    );
    shoulder.add(elbow);
    upper.add(shoulder);
    arms.push(shoulder);
    forearms.push(elbow);
  }

  // Legs: hip pivot -> thigh -> knee pivot -> shin and boot.
  const legs: THREE.Object3D[] = [];
  const shins: THREE.Object3D[] = [];
  for (const x of [-1, 1]) {
    const hip = pivot(x * 0.14, HIP_Y, 0);
    attach(
      hip,
      segment(`thigh:${style}:${ck}:${String(x)}`, (p) => {
        thighDetail(p, style, k, x);
      }),
      body,
    );
    const knee = pivot(0, -0.4, 0);
    attach(
      knee,
      segment(`shin:${style}:${ck}`, (p) => {
        shinDetail(p, style, k);
      }),
      body,
    );
    hip.add(knee);
    group.add(hip);
    legs.push(hip);
    shins.push(knee);
  }

  // Riot shield on the heavy, held in front of the body: a frame, a tinted viewport and a handle.
  if (flags.heavy) {
    const shield = segment(`shield:${ck}`, (p) => {
      p.box(0.9, 1.3, 0.07, k.dark, 0, 0, 0);
      p.box(0.92, 0.06, 0.09, k.helmet, 0, 0.65, 0);
      p.box(0.92, 0.06, 0.09, k.helmet, 0, -0.65, 0);
      p.box(0.06, 1.3, 0.09, k.helmet, -0.45, 0, 0);
      p.box(0.06, 1.3, 0.09, k.helmet, 0.45, 0, 0);
      p.box(0.5, 0.16, 0.08, k.glass, 0, 0.35, 0.01);
      p.box(0.5, 0.04, 0.1, k.accent, 0, -0.1, 0.01);
    });
    const holder = pivot(0, 1.0, 0.42);
    attach(holder, shield, body);
    group.add(holder);
  }

  const mark = markerParts();
  const marker = new THREE.Mesh(mark.geometry, mark.material);
  marker.position.y = 2.25;
  marker.visible = false;
  marker.castShadow = false;
  group.add(marker);

  return {
    group,
    legs,
    arms,
    shins,
    forearms,
    upper,
    head,
    marker,
    gun,
    baseGunZ,
    lean: kind === 'rusher' ? 0.28 : 0,
    flashT: 0,
    deadT: 0,
    clock: 0,
    body,
    flashing: false,
  };
}

// White-out for a moment when the body is hit. The materials are swapped, so no other body is affected.
export function flashHuman(rig: HumanRig, seconds = FLASH_SECONDS): void {
  rig.flashT = Math.max(rig.flashT, seconds);
}

function tickFlash(rig: HumanRig, dt: number): void {
  if (rig.flashT > 0) rig.flashT = Math.max(0, rig.flashT - dt);
  const on = rig.flashT > 0;
  if (on === rig.flashing) return;
  rig.flashing = on;
  for (const b of rig.body) b.mesh.material = on ? flashMaterial : b.material;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// Swings the legs while moving and raises the arms when aiming. Returns the new gait phase; the caller stores it.
// Hips swing, knees bend on the back stroke, shoulders counter-swing, the torso twists against the hips and the
// whole body breathes. Hip and shoulder rotations are the legacy numbers (index.html:2171-2180).
export function animateHuman(rig: HumanRig, state: HumanAnimState, dt: number): number {
  const phase = state.phase + dt * (state.moving ? 9 : 0);
  const swing = Math.sin(phase) * (state.moving ? 0.6 : 0);
  const legL = rig.legs[0];
  const legR = rig.legs[1];
  const armL = rig.arms[0];
  const armR = rig.arms[1];
  if (legL) legL.rotation.x = swing;
  if (legR) legR.rotation.x = -swing;
  // Knees bend while the leg travels back, and a little on the way forward.
  const kneeL = rig.shins[0];
  const kneeR = rig.shins[1];
  const bend = state.moving ? 1 : 0;
  if (kneeL)
    kneeL.rotation.x = lerp(
      kneeL.rotation.x,
      bend * (Math.max(0, Math.sin(phase + 0.9)) * 1.1 + 0.08),
      Math.min(1, dt * 18),
    );
  if (kneeR)
    kneeR.rotation.x = lerp(
      kneeR.rotation.x,
      bend * (Math.max(0, -Math.sin(phase - 0.9)) * 1.1 + 0.08),
      Math.min(1, dt * 18),
    );

  const armTargetR = state.aiming ? -1.45 : -swing * 0.5;
  const armTargetL = state.aiming ? -1.25 : swing * 0.5;
  const blend = Math.min(1, dt * 10);
  if (armR) armR.rotation.x = lerp(armR.rotation.x, armTargetR, blend);
  if (armL) armL.rotation.x = lerp(armL.rotation.x, armTargetL, blend);
  // Reset any death spread when the body stands up again.
  if (armR) armR.rotation.z = lerp(armR.rotation.z, 0, blend);
  if (armL) armL.rotation.z = lerp(armL.rotation.z, 0, blend);
  const elbowL = rig.forearms[0];
  const elbowR = rig.forearms[1];
  if (elbowR)
    elbowR.rotation.x = lerp(
      elbowR.rotation.x,
      state.aiming ? -0.18 : -0.25 - Math.max(0, swing) * 0.8,
      blend,
    );
  if (elbowL)
    elbowL.rotation.x = lerp(
      elbowL.rotation.x,
      state.aiming ? -0.3 : -0.25 - Math.max(0, -swing) * 0.8,
      blend,
    );
  // Aiming brings the left shoulder in so the hand reaches the handguard.
  if (armL) armL.rotation.y = lerp(armL.rotation.y, state.aiming ? 0.45 : 0, blend);
  if (armR) armR.rotation.y = lerp(armR.rotation.y, state.aiming ? -0.12 : 0, blend);

  rig.clock += dt;
  const breath = Math.sin(rig.clock * 1.9) * 0.008;
  const twist = state.moving ? Math.sin(phase) * 0.12 : 0;
  rig.upper.rotation.y = lerp(rig.upper.rotation.y, twist, Math.min(1, dt * 12));
  const upperLean = state.moving ? 0.1 + rig.lean * 0.6 : 0.02 + rig.lean * 0.15;
  rig.upper.rotation.x = lerp(rig.upper.rotation.x, upperLean, Math.min(1, dt * 6));
  rig.upper.position.y = breath + (state.moving ? Math.abs(Math.sin(phase)) * 0.03 : 0);
  rig.head.rotation.y = lerp(rig.head.rotation.y, -twist * 0.8, Math.min(1, dt * 10));
  return phase;
}

// Death fall: the same rotation, lift and tumble as legacy (index.html:2244-2251), plus limbs thrown out and
// a small bounce when the body lands. A dead body only falls: its group position is left where it last stood.
function playDeath(rig: HumanRig, state: HumanPlaceState): void {
  const { group } = rig;
  const landed = state.fall >= 1;
  state.fall = Math.min(1, state.fall + state.dt * 3);
  const f = state.fall;
  group.rotation.x = (-Math.PI / 2) * f;
  group.position.y = 0.3 * f;
  group.rotation.z = state.tumble * 0.5 * f;

  const ease = 1 - (1 - f) * (1 - f);
  const [armL, armR] = rig.arms;
  const [legL, legR] = rig.legs;
  const [kneeL, kneeR] = rig.shins;
  const [elbowL, elbowR] = rig.forearms;
  if (armL) {
    armL.rotation.x = lerp(armL.rotation.x, -2.2 * ease, 0.35);
    armL.rotation.z = lerp(armL.rotation.z, -1.0 * ease * state.tumble, 0.35);
  }
  if (armR) {
    armR.rotation.x = lerp(armR.rotation.x, -1.3 * ease, 0.35);
    armR.rotation.z = lerp(armR.rotation.z, 1.1 * ease * state.tumble, 0.35);
  }
  if (elbowL) elbowL.rotation.x = lerp(elbowL.rotation.x, -0.6 * ease, 0.3);
  if (elbowR) elbowR.rotation.x = lerp(elbowR.rotation.x, -0.9 * ease, 0.3);
  if (legL) legL.rotation.x = lerp(legL.rotation.x, 0.5 * ease, 0.3);
  if (legR) legR.rotation.x = lerp(legR.rotation.x, -0.3 * ease, 0.3);
  if (kneeL) kneeL.rotation.x = lerp(kneeL.rotation.x, 0.9 * ease, 0.3);
  if (kneeR) kneeR.rotation.x = lerp(kneeR.rotation.x, 0.4 * ease, 0.3);
  rig.upper.rotation.x = lerp(rig.upper.rotation.x, 0.25 * ease, 0.3);
  rig.upper.rotation.y = lerp(rig.upper.rotation.y, 0.3 * state.tumble * ease, 0.3);
  rig.head.rotation.x = lerp(rig.head.rotation.x, -0.5 * ease, 0.3);
  rig.head.rotation.z = lerp(rig.head.rotation.z, 0.4 * state.tumble * ease, 0.3);

  // The rifle slips out of the hands and settles.
  rig.gun.position.z = lerp(rig.gun.position.z, rig.baseGunZ + 0.25 * ease, 0.2);
  rig.gun.position.y = lerp(rig.gun.position.y, 1.0, 0.2);

  if (landed) {
    rig.deadT += state.dt;
    // Landing bounce: a couple of decaying hops, then still.
    const t = rig.deadT;
    group.position.y = 0.3 + Math.abs(Math.cos(t * 16)) * 0.09 * Math.exp(-t * 7);
  } else {
    rig.deadT = 0;
  }
  state.crouch = 0;
}

// Writes group transform, scale, marker, gun recoil and death pose. Updates state.fall, state.kick and
// state.crouch in place.
// Legacy: index.html:2244-2251 (dead fall), 2328-2357 (group transform, crouch, bob, gun recoil).
export function placeHumanEnemy(rig: HumanRig, state: HumanPlaceState): void {
  const { group, marker, gun } = rig;
  tickFlash(rig, state.dt);

  if (!state.alive) {
    playDeath(rig, state);
    marker.visible = false;
    return;
  }

  // Upright pose. Only a dead body is ever tilted, so this resets a revived operator.
  // A rusher tilts forward from the hips while it runs.
  group.rotation.x = lerp(group.rotation.x, state.moving ? rig.lean * 0.4 : 0, Math.min(1, state.dt * 8));
  if (rig.lean === 0) group.rotation.x = 0;
  group.rotation.z = 0;
  rig.deadT = 0;
  const blend = Math.min(1, state.dt * 12);
  gun.position.y = lerp(gun.position.y, 1.22, blend);
  rig.head.rotation.x = lerp(rig.head.rotation.x, 0, blend);
  rig.head.rotation.z = lerp(rig.head.rotation.z, 0, blend);

  const kick = Math.max(0, state.flinchT) * 2.5;
  group.position.x = state.x - Math.sin(state.yaw) * kick;
  group.position.z = state.z - Math.cos(state.yaw) * kick;
  // A hit flinch also snaps the upper body back.
  rig.upper.rotation.x += -Math.min(0.35, state.flinchT * 3) * 0.6;

  // Cover: drop into a crouch. Walking: a small bob.
  state.crouch += ((state.hiding ? 1 : 0) - state.crouch) * Math.min(1, state.dt * 7);
  const bs = typeof group.userData.baseScale === 'number' ? group.userData.baseScale : 1;
  group.scale.set(bs, bs * (1 - 0.28 * state.crouch), bs);
  group.position.y = Math.abs(Math.sin(state.phase)) * 0.05 * (state.moving ? 1 : 0);

  marker.visible = state.spot > 0;
  marker.rotation.y = state.time * 3;
  marker.position.y = 2.25 + Math.sin(state.time * 4) * 0.05;

  state.kick = Math.max(0, state.kick - state.dt * 8);
  gun.position.z = rig.baseGunZ - state.kick * 0.12;
  // Muzzle climb on a shot.
  gun.rotation.x = -state.kick * 0.12;

  group.rotation.y = state.yaw;
}
