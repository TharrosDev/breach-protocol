// Procedural first-person gun models. Every weapon is built from boxes and a few cylinders, with its own
// silhouette: rails, magwells, handguards, stocks, sights and moving parts (bolt, magazine, support hand).
// No DOM is needed to build a model: textures are made only when a document exists. The caller adds the
// group to the scene.
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
  rc: { len: 0.85, color: 0x3a3f36 },
  lb: { len: 1.4, color: 0x2b3038 },
  hp: { len: 0.5, color: 0x33323a },
  vp: { len: 0.35, color: 0x3a2e2a },
};

export interface GunModel {
  group: THREE.Group;
  // The magazine, which the viewmodel drops during a reload (magY in gunPose).
  mag: THREE.Object3D;
  // Local z of the muzzle tip, used to place the muzzle flash.
  muzzleZ: number;
  // Moving parts. The bolt (or pistol slide) kicks back on a shot and racks at the end of a reload.
  bolt: THREE.Object3D;
  boltRestZ: number;
  // Travel of the bolt in metres, the shot kick uses a share of it.
  boltTravel: number;
  // The off hand and forearm. It drops toward the magazine during a reload.
  supportHand: THREE.Object3D;
  supportRest: THREE.Vector3;
  // Muzzle flash group at the tip, hidden unless a shot was just fired. Call flashMuzzle to show it.
  flash: THREE.Group;
  // Height of the sights above the gun origin, for ADS lift.
  sightY: number;
}

function isGunId(id: string): id is GunId {
  return Object.prototype.hasOwnProperty.call(GUN_PARTS, id);
}

// ---------------------------------------------------------------------------------------------------------------
// Shared materials. They are cached by key, so every model and every rebuild reuses the same few shaders.

const materials = new Map<string, THREE.Material>();

function std(key: string, params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const cached = materials.get(key);
  if (cached) return cached as THREE.MeshStandardMaterial;
  const m = new THREE.MeshStandardMaterial(params);
  materials.set(key, m);
  return m;
}

function metalMat(color: number): THREE.MeshStandardMaterial {
  return std(`metal:${String(color)}`, { color, roughness: 0.42, metalness: 0.75 });
}
function darkSteel(): THREE.MeshStandardMaterial {
  return std('darkSteel', { color: 0x15181c, roughness: 0.38, metalness: 0.85 });
}
function polymer(): THREE.MeshStandardMaterial {
  return std('polymer', { color: 0x1d1f22, roughness: 0.78, metalness: 0.05 });
}
function rubber(): THREE.MeshStandardMaterial {
  return std('rubber', { color: 0x101113, roughness: 0.95 });
}
function woodMat(): THREE.MeshStandardMaterial {
  return std('wood', { color: 0x6a4a30, roughness: 0.7, metalness: 0.02 });
}
function brassMat(): THREE.MeshStandardMaterial {
  return std('brass', { color: 0xc9a13b, roughness: 0.3, metalness: 0.9 });
}
function shellRed(): THREE.MeshStandardMaterial {
  return std('shellRed', { color: 0xa8281f, roughness: 0.6 });
}
function lensMat(): THREE.MeshStandardMaterial {
  return std('lens', {
    color: 0x0a1018,
    roughness: 0.05,
    metalness: 0.2,
    emissive: 0x2a7bff,
    emissiveIntensity: 0.55,
  });
}
function dotMat(): THREE.MeshBasicMaterial {
  const cached = materials.get('dot');
  if (cached) return cached as THREE.MeshBasicMaterial;
  const m = new THREE.MeshBasicMaterial({ color: 0xff3030 });
  materials.set('dot', m);
  return m;
}
function glowStrip(color: number): THREE.MeshStandardMaterial {
  return std(`glow:${String(color)}`, {
    color: 0x111418,
    emissive: color,
    emissiveIntensity: 1.6,
    roughness: 0.5,
  });
}
function sleeveMat(): THREE.MeshStandardMaterial {
  return std('sleeve', { color: 0x2d3a2b, roughness: 0.92 });
}
function glove(): THREE.MeshStandardMaterial {
  return std('glove', { color: 0x1a1c1e, roughness: 0.85 });
}
function skinMat(): THREE.MeshStandardMaterial {
  return std('skin', { color: 0xc9a77f, roughness: 0.8 });
}

// ---------------------------------------------------------------------------------------------------------------
// Muzzle flash textures and materials (created on first use, only when a document exists).

let flashTexture: THREE.CanvasTexture | null | undefined;
let glowTexture: THREE.CanvasTexture | null | undefined;

function makeCanvas(size: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas.getContext('2d');
}

// A hot star: a bright core, long horizontal and vertical spikes, and a soft fall-off.
function starTexture(): THREE.CanvasTexture | null {
  if (flashTexture !== undefined) return flashTexture;
  const size = 128;
  const g = makeCanvas(size);
  if (g === null) {
    flashTexture = null;
    return null;
  }
  const c = size / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(255,255,235,1)');
  grad.addColorStop(0.18, 'rgba(255,224,150,0.95)');
  grad.addColorStop(0.5, 'rgba(255,150,60,0.35)');
  grad.addColorStop(1, 'rgba(255,100,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  const spike = (angle: number, len: number, width: number): void => {
    g.save();
    g.translate(c, c);
    g.rotate(angle);
    const sg = g.createLinearGradient(-len, 0, len, 0);
    sg.addColorStop(0, 'rgba(255,170,70,0)');
    sg.addColorStop(0.5, 'rgba(255,240,190,0.95)');
    sg.addColorStop(1, 'rgba(255,170,70,0)');
    g.fillStyle = sg;
    g.fillRect(-len, -width / 2, len * 2, width);
    g.restore();
  };
  spike(0, 62, 7);
  spike(Math.PI / 2, 62, 7);
  spike(Math.PI / 4, 40, 4);
  spike(-Math.PI / 4, 40, 4);
  const tex = new THREE.CanvasTexture(g.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  flashTexture = tex;
  return tex;
}

function softGlowTexture(): THREE.CanvasTexture | null {
  if (glowTexture !== undefined) return glowTexture;
  const size = 64;
  const g = makeCanvas(size);
  if (g === null) {
    glowTexture = null;
    return null;
  }
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,230,170,0.9)');
  grad.addColorStop(0.4, 'rgba(255,170,90,0.35)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(g.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  glowTexture = tex;
  return tex;
}

function flashMaterial(map: THREE.Texture | null, color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity: 1,
    fog: false,
  });
}

// Two crossed planes (seen from any angle), a forward cone-ish plane for depth, and a soft glow.
function buildFlash(): THREE.Group {
  const group = new THREE.Group();
  group.visible = false;
  const star = starTexture();
  const glow = softGlowTexture();
  const plane = new THREE.PlaneGeometry(0.34, 0.34);
  const a = new THREE.Mesh(plane, flashMaterial(star, 0xffe2a8));
  const b = new THREE.Mesh(plane, flashMaterial(star, 0xffc070));
  b.rotation.z = Math.PI / 4;
  const c = new THREE.Mesh(plane, flashMaterial(star, 0xffd890));
  c.rotation.y = Math.PI / 2;
  c.position.z = 0.06;
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), flashMaterial(glow, 0xff9a50));
  halo.position.z = 0.02;
  group.add(halo, a, b, c);
  group.renderOrder = 10;
  group.traverse((o) => {
    o.renderOrder = 10;
  });
  return group;
}

// Shows the flash for a shot: a random roll and size, 0..1 strength. Call with 0 to hide.
export function flashMuzzle(model: GunModel, strength: number, seed = 0): void {
  const s = Math.max(0, Math.min(1, strength));
  model.flash.visible = s > 0.02;
  if (!model.flash.visible) return;
  model.flash.rotation.z = seed * 6.283;
  const size = (0.55 + 0.7 * s) * (0.85 + (seed % 0.37));
  model.flash.scale.setScalar(size);
  model.flash.traverse((o) => {
    if (o instanceof THREE.Mesh) (o.material as THREE.MeshBasicMaterial).opacity = Math.min(1, s * 1.4);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Builder

interface Style {
  // Receiver proportions: half-size scale for the look of the weapon.
  recH: number;
  recW: number;
  mag: { w: number; h: number; d: number; tilt: number; z: number };
  stock: 'fixed' | 'wire' | 'wood' | 'none' | 'sniper' | 'skeleton';
  rail: boolean;
  barrelR: number;
  muzzle: 'brake' | 'bare' | 'shroud' | 'flashhider';
  grip: number; // pistol grip tilt in radians
}

const STYLES: Readonly<Record<string, Style>> = {
  vx: {
    recH: 0.1,
    recW: 0.075,
    mag: { w: 0.05, h: 0.15, d: 0.07, tilt: 0.18, z: 0.45 },
    stock: 'fixed',
    rail: true,
    barrelR: 0.014,
    muzzle: 'flashhider',
    grip: 0.3,
  },
  kv: {
    recH: 0.095,
    recW: 0.07,
    mag: { w: 0.04, h: 0.2, d: 0.06, tilt: 0, z: 0.35 },
    stock: 'wire',
    rail: true,
    barrelR: 0.013,
    muzzle: 'shroud',
    grip: 0.25,
  },
  bk: {
    recH: 0.105,
    recW: 0.08,
    mag: { w: 0.03, h: 0.03, d: 0.04, tilt: 0, z: 0.2 },
    stock: 'wood',
    rail: false,
    barrelR: 0.02,
    muzzle: 'bare',
    grip: 0.2,
  },
  lm: {
    recH: 0.11,
    recW: 0.085,
    mag: { w: 0.09, h: 0.13, d: 0.12, tilt: 0, z: 0.4 },
    stock: 'fixed',
    rail: true,
    barrelR: 0.019,
    muzzle: 'flashhider',
    grip: 0.3,
  },
  dm: {
    recH: 0.1,
    recW: 0.075,
    mag: { w: 0.045, h: 0.13, d: 0.065, tilt: 0.1, z: 0.45 },
    stock: 'skeleton',
    rail: true,
    barrelR: 0.016,
    muzzle: 'brake',
    grip: 0.3,
  },
  rc: {
    recH: 0.098,
    recW: 0.072,
    mag: { w: 0.045, h: 0.14, d: 0.065, tilt: 0.14, z: 0.45 },
    stock: 'wire',
    rail: true,
    barrelR: 0.014,
    muzzle: 'flashhider',
    grip: 0.3,
  },
  lb: {
    recH: 0.095,
    recW: 0.07,
    mag: { w: 0.04, h: 0.07, d: 0.06, tilt: 0, z: 0.4 },
    stock: 'sniper',
    rail: true,
    barrelR: 0.018,
    muzzle: 'brake',
    grip: 0.15,
  },
  hp: {
    recH: 0.092,
    recW: 0.068,
    mag: { w: 0.04, h: 0.16, d: 0.055, tilt: 0, z: 0.3 },
    stock: 'none',
    rail: true,
    barrelR: 0.012,
    muzzle: 'shroud',
    grip: 0.25,
  },
  vp: {
    recH: 0.075,
    recW: 0.04,
    mag: { w: 0.032, h: 0.1, d: 0.05, tilt: 0.05, z: 0.5 },
    stock: 'none',
    rail: false,
    barrelR: 0.011,
    muzzle: 'bare',
    grip: 0.28,
  },
};

const DEFAULT_STYLE: Style = STYLES.vx as Style;

// index.html:1154-1183 sizes the receiver and barrel from `len`; those two numbers are kept.
export function buildGunModel(id: string): GunModel {
  if (!isGunId(id)) throw new Error(`Unknown gun id: ${id}`);
  const { len, color } = GUN_PARTS[id];
  const st = STYLES[id] ?? DEFAULT_STYLE;
  const isPistol = id === SIDEARM_ID;

  const L2 = 0.25 + len * 0.45;
  const b = 0.15 + len * 0.25;
  const group = new THREE.Group();
  const detail = new THREE.Group();
  detail.name = 'detail';
  group.add(detail);

  const metal = metalMat(color);
  const steel = darkSteel();
  const poly = polymer();

  const addTo = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = detail,
  ): THREE.Mesh => addTo(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const cyl = (
    r: number,
    length: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = detail,
    segs = 10,
  ): THREE.Mesh => {
    const m = addTo(parent, new THREE.CylinderGeometry(r, r, length, segs), mat, x, y, z);
    m.rotation.x = Math.PI / 2;
    return m;
  };

  // --- receiver: the legacy box stays a direct child, with an upper and a lower half for a stepped look ----------
  const recY = st.recH;
  const rec = box(st.recW, recY, L2, metal, 0, 0, -L2 / 2, group);
  rec.name = 'receiver';
  // Lower receiver band and magwell.
  box(st.recW + 0.006, 0.03, L2 * 0.55, steel, 0, -recY / 2 + 0.01, -L2 * 0.62);
  box(st.mag.w + 0.025, 0.045, st.mag.d + 0.025, steel, 0, -recY / 2 - 0.02, -L2 * (1 - st.mag.z) * 0.9 + 0);
  // Ejection port: a dark recess on the right side with a brass dust cover edge.
  if (!isPistol) {
    box(0.006, 0.035, L2 * 0.22, rubber(), st.recW / 2 + 0.001, 0.015, -L2 * 0.45);
    box(0.008, 0.008, L2 * 0.3, brassMat(), st.recW / 2 + 0.001, 0.036, -L2 * 0.45);
  }
  // Receiver screws and panel lines.
  for (let i = 0; i < 3; i++)
    box(0.004, 0.012, 0.012, steel, -st.recW / 2 - 0.001, 0.03 - i * 0.025, -L2 * (0.25 + i * 0.2));

  // --- barrel ----------------------------------------------------------------------------------------------------
  const barrelLen = b;
  const barrel = cyl(st.barrelR, barrelLen, steel, 0, 0.012, -L2 - b / 2);
  barrel.name = 'barrel';
  // Chamber collar and gas block.
  cyl(st.barrelR * 1.5, 0.05, metal, 0, 0.012, -L2 - 0.03);
  if (id === 'vx' || id === 'rc' || id === 'dm' || id === 'lm') {
    box(0.024, 0.024, 0.04, steel, 0, 0.028, -L2 - b * 0.55);
    cyl(0.006, b * 0.5, steel, 0, 0.044, -L2 - b * 0.4);
  }

  // Muzzle device.
  const tip = -L2 - b;
  switch (st.muzzle) {
    case 'flashhider':
      cyl(st.barrelR * 1.5, 0.07, steel, 0, 0.012, tip + 0.02);
      for (let i = 0; i < 3; i++) box(0.04, 0.004, 0.008, rubber(), 0, 0.012, tip + 0.045 - i * 0.02);
      break;
    case 'brake':
      cyl(st.barrelR * 1.7, 0.1, steel, 0, 0.012, tip + 0.03);
      for (let i = 0; i < 4; i++) box(0.05, 0.006, 0.01, rubber(), 0, 0.012, tip + 0.06 - i * 0.02);
      break;
    case 'shroud':
      cyl(st.barrelR * 2.1, b * 0.7, steel, 0, 0.012, -L2 - b * 0.45);
      for (let i = 0; i < 5; i++) box(0.045, 0.005, 0.01, rubber(), 0, 0.012, -L2 - b * 0.2 - i * 0.04);
      break;
    default:
      cyl(st.barrelR * 1.25, 0.03, steel, 0, 0.012, tip + 0.01);
  }

  // --- sights ----------------------------------------------------------------------------------------------------
  let sightY = recY / 2 + 0.03;
  const addIronSights = (): void => {
    // Front post in a hood, rear aperture with wings.
    box(0.006, 0.05, 0.008, steel, 0, recY / 2 + 0.025, -L2 - b * 0.55);
    box(0.02, 0.006, 0.012, steel, 0, recY / 2 + 0.002, -L2 - b * 0.55);
    box(0.008, 0.03, 0.012, steel, -0.016, recY / 2 + 0.03, -L2 * 0.12);
    box(0.008, 0.03, 0.012, steel, 0.016, recY / 2 + 0.03, -L2 * 0.12);
    box(0.04, 0.008, 0.012, steel, 0, recY / 2 + 0.012, -L2 * 0.12);
    sightY = recY / 2 + 0.05;
  };
  const addRail = (z0: number, z1: number, y: number): void => {
    const length = Math.abs(z1 - z0);
    box(0.026, 0.012, length, steel, 0, y, (z0 + z1) / 2);
    const n = Math.max(3, Math.round(length / 0.03));
    for (let i = 0; i < n; i++) box(0.03, 0.007, 0.012, steel, 0, y + 0.008, z0 - ((i + 0.5) / n) * length);
  };
  const addReflex = (z: number): void => {
    box(0.036, 0.012, 0.05, steel, 0, recY / 2 + 0.014, z);
    box(0.004, 0.04, 0.05, steel, -0.019, recY / 2 + 0.04, z);
    box(0.004, 0.04, 0.05, steel, 0.019, recY / 2 + 0.04, z);
    box(0.036, 0.006, 0.05, steel, 0, recY / 2 + 0.062, z);
    const lens = box(0.034, 0.034, 0.003, lensMat(), 0, recY / 2 + 0.04, z - 0.022);
    lens.rotation.x = -0.1;
    box(0.006, 0.006, 0.002, dotMat(), 0, recY / 2 + 0.04, z - 0.0235);
    sightY = recY / 2 + 0.065;
  };
  const addScope = (z: number, long: number, r: number, objective: number): void => {
    // Mount rings, tube, objective bell, eyepiece and turrets.
    box(0.03, 0.03, 0.025, steel, 0, recY / 2 + 0.018, z + long * 0.3);
    box(0.03, 0.03, 0.025, steel, 0, recY / 2 + 0.018, z - long * 0.3);
    const tube = cyl(r, long, metalMat(0x14171b), 0, recY / 2 + 0.045, z, group, 14);
    tube.name = 'scope';
    cyl(objective, long * 0.22, steel, 0, recY / 2 + 0.045, z - long * 0.55, detail, 14);
    cyl(r * 1.25, long * 0.16, steel, 0, recY / 2 + 0.045, z + long * 0.55, detail, 14);
    const glass = cyl(objective * 0.9, 0.004, lensMat(), 0, recY / 2 + 0.045, z - long * 0.66, detail, 14);
    glass.name = 'scope-glass';
    box(0.014, 0.014, 0.02, steel, 0, recY / 2 + 0.045 + r + 0.006, z);
    box(0.014, 0.02, 0.014, steel, r + 0.006, recY / 2 + 0.045, z);
    sightY = recY / 2 + 0.045 + r;
  };

  // --- per-weapon silhouettes ------------------------------------------------------------------------------------
  const handguardTop = recY / 2;
  switch (id) {
    case 'vx': {
      // Carry-handle rail with a rear sight, ribbed handguard.
      addRail(-L2 * 0.08, -L2 - b * 0.12, handguardTop + 0.006);
      addIronSights();
      box(0.06, 0.07, b * 0.78, poly, 0, -0.005, -L2 - b * 0.4);
      for (let i = 0; i < 6; i++) box(0.062, 0.012, 0.006, steel, 0, 0.03, -L2 - b * 0.1 - i * 0.045);
      box(0.014, 0.014, b * 0.5, glowStrip(0x58b7ff), 0.031, 0.005, -L2 - b * 0.4);
      break;
    }
    case 'kv': {
      // Compact SMG: top rail with reflex, vertical foregrip, slotted shroud.
      addRail(-L2 * 0.05, -L2 - b * 0.1, handguardTop + 0.006);
      addReflex(-L2 * 0.5);
      box(0.03, 0.09, 0.035, poly, 0, -0.08, -L2 - b * 0.18);
      box(0.026, 0.03, 0.05, poly, 0, -0.04, -L2 - b * 0.18);
      box(0.012, 0.012, b * 0.6, glowStrip(0xffb020), 0.036, 0.0, -L2 - b * 0.35);
      break;
    }
    case 'bk': {
      // Pump shotgun: wooden pump forend, tube magazine, side-saddle shells, bead sight.
      box(0.075, 0.07, 0.22, woodMat(), 0, -0.04, -L2 - b * 0.35);
      cyl(0.018, L2 + b * 0.5, steel, 0, -0.03, -(L2 + b * 0.5) / 2 - 0.02);
      cyl(0.022, 0.012, steel, 0, -0.03, -L2 - b * 0.6);
      for (let i = 0; i < 5; i++)
        box(0.012, 0.03, 0.026, shellRed(), -st.recW / 2 - 0.008, 0.0, -0.03 - i * 0.034);
      box(0.014, 0.012, 0.18, steel, 0, recY / 2 + 0.008, -L2 * 0.5);
      box(0.008, 0.02, 0.008, brassMat(), 0, recY / 2 + 0.032, -L2 - b * 0.85);
      sightY = recY / 2 + 0.04;
      break;
    }
    case 'lm': {
      // LMG: carry handle, heavy shroud, belt-fed box with a loose belt, bipod folded under the barrel.
      box(0.07, 0.085, b * 0.7, poly, 0, 0.0, -L2 - b * 0.36);
      for (let i = 0; i < 5; i++) box(0.072, 0.014, 0.012, steel, 0, 0.032, -L2 - b * 0.12 - i * 0.05);
      box(0.012, 0.045, L2 * 0.55, steel, 0, recY / 2 + 0.04, -L2 * 0.45);
      box(0.012, 0.012, L2 * 0.55, steel, 0, recY / 2 + 0.065, -L2 * 0.45);
      box(0.006, 0.02, 0.012, steel, 0, recY / 2 + 0.078, -L2 * 0.15);
      // Belt: brass rounds hanging from the feed tray.
      for (let i = 0; i < 6; i++) {
        const r = box(
          0.012,
          0.012,
          0.03,
          brassMat(),
          -st.recW / 2 - 0.012 - i * 0.002,
          -0.04 - i * 0.012,
          -L2 * 0.4,
        );
        r.rotation.x = 0.4 + i * 0.1;
      }
      const bipodL = box(0.008, 0.008, 0.11, steel, -0.025, -0.06, -L2 - b * 0.3);
      bipodL.rotation.x = 0.1;
      const bipodR = box(0.008, 0.008, 0.11, steel, 0.025, -0.06, -L2 - b * 0.3);
      bipodR.rotation.x = 0.1;
      sightY = recY / 2 + 0.08;
      break;
    }
    case 'dm': {
      addRail(-L2 * 0.05, -L2 - b * 0.4, handguardTop + 0.006);
      addScope(-L2 * 0.38, 0.22, 0.03, 0.036);
      box(0.06, 0.07, b * 0.6, poly, 0, -0.005, -L2 - b * 0.3);
      box(0.012, 0.012, b * 0.5, glowStrip(0x58b7ff), 0.031, 0.004, -L2 - b * 0.3);
      // Bipod stub and cheek rest.
      box(0.05, 0.03, 0.12, poly, 0, 0.05, 0.1);
      break;
    }
    case 'rc': {
      addRail(-L2 * 0.05, -L2 - b * 0.15, handguardTop + 0.006);
      addReflex(-L2 * 0.55);
      box(0.058, 0.066, b * 0.7, poly, 0, -0.004, -L2 - b * 0.38);
      for (let i = 0; i < 4; i++) box(0.06, 0.01, 0.006, steel, 0, 0.028, -L2 - b * 0.12 - i * 0.045);
      box(0.014, 0.014, 0.05, glowStrip(0x4dff9a), 0.03, 0.003, -L2 - b * 0.55);
      break;
    }
    case 'lb': {
      // Bolt-action sniper: long scope, bolt handle, chassis stock, bipod.
      addScope(-L2 * 0.4, 0.3, 0.026, 0.04);
      box(0.06, 0.06, b * 0.55, poly, 0, -0.01, -L2 - b * 0.32);
      cyl(0.024, b * 0.5, steel, 0, 0.012, -L2 - b * 0.55);
      const bipod = box(0.05, 0.008, 0.008, steel, 0, -0.05, -L2 - b * 0.4);
      bipod.rotation.z = 0.0;
      box(0.008, 0.008, 0.12, steel, -0.025, -0.055, -L2 - b * 0.4);
      box(0.008, 0.008, 0.12, steel, 0.025, -0.055, -L2 - b * 0.4);
      box(0.06, 0.04, 0.14, poly, 0, 0.055, 0.1);
      break;
    }
    case 'hp': {
      addRail(-L2 * 0.05, -L2 - b * 0.1, handguardTop + 0.006);
      addReflex(-L2 * 0.45);
      box(0.018, 0.026, 0.07, glowStrip(0xff3b3b), 0.0, -0.065, -L2 - b * 0.15);
      box(0.012, 0.012, b * 0.35, glowStrip(0xffb020), 0.035, 0.0, -L2 - b * 0.3);
      break;
    }
    default: {
      // Pistol: serrated slide, rear and front sights, accessory rail.
      for (let i = 0; i < 5; i++) box(0.046, 0.05, 0.006, steel, 0, 0.0, -L2 * 0.1 - i * 0.012);
      box(0.006, 0.014, 0.012, steel, 0, recY / 2 + 0.006, -L2 - 0.0);
      box(0.026, 0.01, 0.012, steel, 0, recY / 2 + 0.006, -0.015);
      box(0.03, 0.02, L2 * 0.5, steel, 0, -recY / 2 - 0.004, -L2 * 0.7);
      box(0.012, 0.012, 0.05, glowStrip(0xff5a5a), 0.0, -recY / 2 - 0.024, -L2 * 0.8);
      sightY = recY / 2 + 0.02;
    }
  }

  // --- magazine (a direct child, dropped during a reload) ---------------------------------------------------------
  const mgeo = new THREE.BoxGeometry(st.mag.w, st.mag.h, st.mag.d);
  const mag = addTo(group, mgeo, poly, 0, -0.11, -L2 * (1 - st.mag.z) * 0.9);
  mag.rotation.x = st.mag.tilt;
  // Mag floorplate, witness holes and a brass round peeking out of the top.
  box(st.mag.w + 0.008, 0.012, st.mag.d + 0.008, steel, 0, -st.mag.h / 2, 0, mag);
  for (let i = 0; i < 3; i++)
    box(st.mag.w + 0.002, 0.008, 0.012, brassMat(), 0, -st.mag.h / 2 + 0.03 + i * 0.026, 0, mag);
  if (id === 'lm') {
    // Ammo box: ribbed sides.
    for (let i = 0; i < 4; i++)
      box(st.mag.w + 0.006, 0.008, st.mag.d - 0.01, steel, 0, -0.04 + i * 0.026, 0, mag);
  }
  if (id === 'bk') mag.visible = false;

  // --- grip, trigger group ---------------------------------------------------------------------------------------
  const gripPivot = new THREE.Group();
  gripPivot.position.set(0, -0.1, 0.0);
  gripPivot.rotation.x = st.grip;
  group.add(gripPivot);
  addTo(gripPivot, new THREE.BoxGeometry(0.05, 0.12, 0.06), poly, 0, 0, 0);
  for (let i = 0; i < 4; i++) box(0.052, 0.006, 0.062, rubber(), 0, -0.04 + i * 0.022, 0, gripPivot);
  box(0.016, 0.01, 0.04, steel, 0, -0.058, 0.0, gripPivot);
  // Trigger guard (three bars) and trigger.
  box(0.012, 0.008, 0.07, steel, 0, -recY / 2 - 0.035, -0.04);
  box(0.012, 0.035, 0.008, steel, 0, -recY / 2 - 0.018, -0.075);
  box(0.012, 0.035, 0.008, steel, 0, -recY / 2 - 0.018, -0.005);
  box(0.008, 0.026, 0.01, steel, 0, -recY / 2 - 0.018, -0.032).rotation.x = 0.3;

  // --- stock -----------------------------------------------------------------------------------------------------
  const stockMat = id === 'bk' ? woodMat() : poly;
  switch (st.stock) {
    case 'fixed':
      box(0.06, 0.09, 0.2, poly, 0, -0.02, 0.1, group);
      box(0.064, 0.1, 0.02, rubber(), 0, -0.02, 0.21);
      box(0.04, 0.02, 0.12, steel, 0, 0.035, 0.12);
      break;
    case 'wood':
      box(0.06, 0.09, 0.2, stockMat, 0, -0.02, 0.1, group);
      box(0.064, 0.12, 0.025, rubber(), 0, -0.03, 0.215);
      box(0.05, 0.04, 0.1, stockMat, 0, 0.0, 0.0);
      break;
    case 'wire':
      box(0.06, 0.09, 0.2, poly, 0, -0.02, 0.1, group).scale.set(0.8, 0.7, 0.6);
      box(0.01, 0.01, 0.16, steel, -0.02, 0.012, 0.16);
      box(0.01, 0.01, 0.16, steel, 0.02, 0.012, 0.16);
      box(0.01, 0.01, 0.16, steel, -0.02, -0.05, 0.16);
      box(0.01, 0.01, 0.16, steel, 0.02, -0.05, 0.16);
      box(0.05, 0.075, 0.016, rubber(), 0, -0.02, 0.245);
      break;
    case 'skeleton':
      box(0.06, 0.09, 0.2, poly, 0, -0.02, 0.1, group).scale.set(1, 0.75, 1);
      box(0.02, 0.012, 0.18, steel, 0, 0.03, 0.14);
      box(0.02, 0.012, 0.18, steel, 0, -0.07, 0.14);
      box(0.058, 0.09, 0.03, rubber(), 0, -0.02, 0.24);
      break;
    case 'sniper':
      box(0.06, 0.09, 0.2, poly, 0, -0.02, 0.1, group);
      box(0.054, 0.05, 0.14, poly, 0, 0.04, 0.19);
      box(0.058, 0.1, 0.03, rubber(), 0, -0.03, 0.27);
      break;
    default:
      // No shoulder stock: the legacy box stays so the receiver does not look cut off.
      box(0.06, 0.09, 0.2, poly, 0, -0.02, 0.1, group).scale.set(
        isPistol ? 0.7 : 0.9,
        isPistol ? 0.55 : 0.8,
        isPistol ? 0.3 : 0.5,
      );
  }

  // --- moving bolt / slide ---------------------------------------------------------------------------------------
  const bolt = new THREE.Group();
  const boltRestZ = 0;
  group.add(bolt);
  let boltTravel = 0.045;
  if (isPistol) {
    // The slide itself moves.
    boltTravel = 0.04;
    const slide = box(st.recW - 0.004, 0.05, L2 * 0.9, steel, 0, 0.012, -L2 * 0.5, bolt);
    slide.name = 'slide';
    box(0.044, 0.012, L2 * 0.9, metal, 0, 0.042, -L2 * 0.5, bolt);
  } else if (id === 'lb') {
    boltTravel = 0.07;
    box(0.012, 0.012, 0.05, steel, st.recW / 2 + 0.008, 0.03, -L2 * 0.25, bolt);
    cyl(0.008, 0.06, steel, st.recW / 2 + 0.035, 0.03, -L2 * 0.25, bolt).rotation.set(0, 0, Math.PI / 2);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), steel);
    knob.position.set(st.recW / 2 + 0.065, 0.03, -L2 * 0.25);
    bolt.add(knob);
  } else if (id === 'bk') {
    boltTravel = 0.07;
    // The pump forend slides.
    box(0.08, 0.075, 0.2, woodMat(), 0, -0.04, -L2 - b * 0.3, bolt);
    for (let i = 0; i < 5; i++) box(0.082, 0.006, 0.012, rubber(), 0, -0.04, -L2 - b * 0.15 - i * 0.03, bolt);
  } else {
    // Charging handle on the left, bolt carrier on the ejection side.
    box(0.012, 0.014, 0.05, steel, -0.034, 0.04, -L2 * 0.3, bolt);
    box(0.02, 0.02, 0.012, steel, -0.044, 0.04, -L2 * 0.3, bolt);
    box(0.01, 0.026, L2 * 0.2, brassMat(), st.recW / 2 + 0.003, 0.016, -L2 * 0.45, bolt);
  }

  // --- arms and hands --------------------------------------------------------------------------------------------
  // Right: sleeve, glove with fingers wrapped around the grip. Left: forearm and glove under the handguard.
  const sleeve = sleeveMat();
  const gl = glove();
  box(0.08, 0.08, 0.3, sleeve, 0.02, -0.16, 0.25, group);
  box(0.075, 0.03, 0.06, gl, 0.02, -0.1, 0.07, group);
  const rh = box(0.07, 0.07, 0.07, skinMat(), 0.0, -0.08, -0.02, group);
  rh.name = 'right-hand';
  for (let i = 0; i < 3; i++) box(0.012, 0.014, 0.05, gl, -0.034, -0.12 + i * 0.0, -0.01 - i * 0.012, group);
  box(0.018, 0.018, 0.045, gl, 0.0, -recY / 2 - 0.02, -0.07, group);

  const support = new THREE.Group();
  const handZ = isPistol ? 0.02 : -L2 * 0.5;
  const supportRest = new THREE.Vector3(isPistol ? 0.0 : -0.05, -0.04, handZ);
  support.position.copy(supportRest);
  group.add(support);
  box(0.07, 0.07, 0.07, skinMat(), 0, 0, 0, support).name = 'left-hand';
  box(0.075, 0.03, 0.08, gl, 0, -0.025, 0.0, support);
  box(0.016, 0.02, 0.05, gl, 0.03, 0.03, -0.01, support);
  box(0.016, 0.02, 0.05, gl, 0.015, 0.03, -0.035, support);
  // Forearm, a sleeve running back toward the camera.
  const forearm = box(0.07, 0.07, 0.3, sleeve, -0.08, -0.01, 0.2, support);
  forearm.rotation.y = 0.45;
  box(
    0.074,
    0.02,
    0.06,
    std('cuff', { color: 0x1c241b, roughness: 0.9 }),
    -0.05,
    -0.01,
    0.07,
    support,
  ).rotation.y = 0.45;

  // --- muzzle flash ----------------------------------------------------------------------------------------------
  const flash = buildFlash();
  flash.position.set(0, 0.012, tip - 0.05);
  group.add(flash);

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.frustumCulled = false;
  });

  return {
    group,
    mag,
    muzzleZ: -L2 - b,
    bolt,
    boltRestZ,
    boltTravel,
    supportHand: support,
    supportRest,
    flash,
    sightY,
  };
}

// Applies a pose from gunPose (and the model-specific moving parts) to a model. One call per frame.
export interface PoseLike {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  magY: number;
  boltZ?: number;
  hand?: readonly [number, number, number];
}

export function poseGun(model: GunModel, pose: PoseLike): void {
  model.group.position.set(pose.position[0], pose.position[1], pose.position[2]);
  model.group.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2]);
  model.mag.position.y = pose.magY;
  model.bolt.position.z = model.boltRestZ + (pose.boltZ ?? 0) * model.boltTravel;
  const h = pose.hand;
  model.supportHand.position.set(
    model.supportRest.x + (h?.[0] ?? 0),
    model.supportRest.y + (h?.[1] ?? 0),
    model.supportRest.z + (h?.[2] ?? 0),
  );
}
