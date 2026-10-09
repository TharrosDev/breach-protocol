import * as THREE from 'three';
import type { Rng } from '../core/rng';
import type { BoxId, CollisionWorld } from '../sim/collision';

export interface LampPlacement {
  x: number;
  z: number;
}

export interface ZoneCentre {
  x: number;
  z: number;
}

const HALF_EXTENT = 48;
const TRIES = 400;
const CLEAR_RADIUS = 1.0;
// Legacy compares squared distance with 100 (index.html:3118), i.e. a 10 m radius.
const ZONE_CLEAR_SQ = 100;
const POLE_HALF = 0.12;
const POLE_HEIGHT = 4.4;
const HEAD_Y = 4.45;
const GLOW_Y = 4.1;
const GLOW_SCALE = 3.4;

// Pure placement (legacy scatterLamps, index.html:3113-3123). The poles of earlier lamps count as
// obstacles, as they do in legacy, but the world is only read here; buildLamps adds the poles.
export function lampPlacements(
  rng: Rng,
  count: number,
  world: CollisionWorld,
  zones: readonly ZoneCentre[],
): LampPlacement[] {
  const placed: LampPlacement[] = [];
  for (let i = 0; i < TRIES && placed.length < count; i++) {
    const x = rng.range(-HALF_EXTENT, HALF_EXTENT);
    const z = rng.range(-HALF_EXTENT, HALF_EXTENT);
    if (!world.pointFree(x, z, CLEAR_RADIUS)) continue;
    if (!placed.every((p) => poleClear(x, z, p.x, p.z))) continue;
    if (zones.some((zd) => sqDist(x, z, zd.x, zd.z) < ZONE_CLEAR_SQ)) continue;
    placed.push({ x, z });
  }
  return placed;
}

// Places the lamps, adds each steel pole to the collision world (height 4.4) and builds the
// emissive heads and glow sprites. dispose() removes the poles and frees what this build created.
export function buildLamps(
  scene: THREE.Scene,
  rng: Rng,
  count: number,
  world: CollisionWorld,
  zones: readonly ZoneCentre[],
): { meshes: THREE.Object3D[]; dispose(): void } {
  const sites = lampPlacements(rng, count, world, zones);

  const headGeo = new THREE.BoxGeometry(0.5, 0.1, 0.35);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x222222,
    emissive: 0xffd9a0,
    emissiveIntensity: 2.2,
  });
  const glowTex = makeGlowTexture();
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  const meshes: THREE.Object3D[] = [];
  const poleIds: BoxId[] = [];
  for (const { x, z } of sites) {
    poleIds.push(
      world.add({
        min: { x: x - POLE_HALF, y: 0, z: z - POLE_HALF },
        max: { x: x + POLE_HALF, y: POLE_HEIGHT, z: z + POLE_HALF },
      }),
    );
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(x, HEAD_Y, z);
    const glow = new THREE.Sprite(glowMat);
    glow.position.set(x, GLOW_Y, z);
    glow.scale.setScalar(GLOW_SCALE);
    scene.add(head, glow);
    meshes.push(head, glow);
  }

  let disposed = false;
  return {
    meshes,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const id of poleIds) world.remove(id);
      for (const m of meshes) scene.remove(m);
      headGeo.dispose();
      headMat.dispose();
      glowMat.dispose();
      glowTex.dispose();
    },
  };
}

// Legacy TEX_FX.glow (index.html:1117-1123): a 128 px radial gradient.
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g !== null) {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,225,170,0.9)');
    grad.addColorStop(0.35, 'rgba(255,190,110,0.25)');
    grad.addColorStop(1, 'rgba(255,160,80,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// True when the circle of radius CLEAR_RADIUS around (x, z) does not touch a pole footprint at (px, pz).
function poleClear(x: number, z: number, px: number, pz: number): boolean {
  const cx = clamp(x, px - POLE_HALF, px + POLE_HALF);
  const cz = clamp(z, pz - POLE_HALF, pz + POLE_HALF);
  return (x - cx) ** 2 + (z - cz) ** 2 >= CLEAR_RADIUS * CLEAR_RADIUS;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function sqDist(ax: number, az: number, bx: number, bz: number): number {
  return (ax - bx) ** 2 + (az - bz) ** 2;
}
