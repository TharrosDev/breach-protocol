import * as THREE from 'three';
import type { Rng } from '../core/rng';
import type { CollisionWorld } from '../sim/collision';

export interface GrassPlacement {
  x: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
}

const HALF_EXTENT = 55;
const TRIES_PER_TUFT = 6;
const COLLIDER_CLEARANCE = 0.5;
// Legacy compares the squared distance with 16 (index.html:3083), so a tuft is kept out of a
// zone's 4 m radius. Changing this changes parity with the legacy look.
const ZONE_CLEAR_SQ = 16;
const TAU = Math.PI * 2;

export interface ZoneCentre {
  x: number;
  z: number;
}

// Pure placement (legacy scatterGrass, index.html:3074-3092). isOpen(x, z, r) answers whether a
// circle of radius r clears every collider. Returns at most count placements.
export function grassPlacements(
  rng: Rng,
  count: number,
  isOpen: (x: number, z: number, r: number) => boolean,
  zones: readonly ZoneCentre[],
): GrassPlacement[] {
  const out: GrassPlacement[] = [];
  for (let i = 0; i < count * TRIES_PER_TUFT && out.length < count; i++) {
    const x = rng.range(-HALF_EXTENT, HALF_EXTENT);
    const z = rng.range(-HALF_EXTENT, HALF_EXTENT);
    if (!isOpen(x, z, COLLIDER_CLEARANCE)) continue;
    if (zones.some((zd) => sqDist(x, z, zd.x, zd.z) < ZONE_CLEAR_SQ)) continue;
    const yaw = rng.range(0, TAU);
    const sc = rng.range(0.7, 1.6);
    const sy = sc * rng.range(0.8, 1.4);
    out.push({ x, z, yaw, sx: sc, sy });
  }
  return out;
}

// One InstancedMesh per map build. The blade texture is drawn lazily here, so importing this module
// never touches the DOM.
export function buildGrass(
  scene: THREE.Scene,
  rng: Rng,
  count: number,
  world: CollisionWorld,
  zones: readonly ZoneCentre[],
): THREE.InstancedMesh {
  const placements = grassPlacements(rng, count, (x, z, r) => world.pointFree(x, z, r), zones);

  const geo = new THREE.PlaneGeometry(0.7, 0.7);
  geo.translate(0, 0.35, 0);
  const mat = new THREE.MeshStandardMaterial({
    map: makeGrassTexture(rng.fork('grass-texture')),
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  const im = new THREE.InstancedMesh(geo, mat, count);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  placements.forEach((pl, i) => {
    q.setFromAxisAngle(up, pl.yaw);
    s.set(pl.sx, pl.sy, pl.sx);
    p.set(pl.x, 0, pl.z);
    m4.compose(p, q, s);
    im.setMatrixAt(i, m4);
  });
  im.count = placements.length;
  im.instanceMatrix.needsUpdate = true;
  scene.add(im);
  return im;
}

// Legacy TEX_FX.grass (index.html:1134-1143): 16 curved blade strokes on a 64 px canvas.
function makeGrassTexture(rng: Rng): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g !== null) {
    for (let i = 0; i < 16; i++) {
      const hue = String(80 + rng.range(0, 25));
      const light = String(26 + rng.range(0, 20));
      g.strokeStyle = `hsl(${hue} 45% ${light}%)`;
      g.lineWidth = 2 + rng.range(0, 2);
      const x = 6 + rng.range(0, 52);
      g.beginPath();
      g.moveTo(x, size);
      g.quadraticCurveTo(
        x + rng.range(-0.5, 0.5) * 18,
        size * 0.55,
        x + rng.range(-0.5, 0.5) * 26,
        4 + rng.range(0, 14),
      );
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function sqDist(ax: number, az: number, bx: number, bz: number): number {
  return (ax - bx) ** 2 + (az - bz) ** 2;
}
