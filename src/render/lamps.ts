import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cachedTexture, freezeStatic } from './texture-cache';
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
): { meshes: THREE.Object3D[]; update(time: number): void; dispose(): void } {
  const sites = lampPlacements(rng, count, world, zones);

  const headGeo = new THREE.BoxGeometry(0.5, 0.1, 0.35);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x222222,
    emissive: 0xffd9a0,
    emissiveIntensity: 2.2,
  });
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, POLE_HEIGHT, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.5, metalness: 0.7 });
  const armGeo = new THREE.BoxGeometry(0.12, 0.08, 0.6);
  const baseGeo = new THREE.CylinderGeometry(0.2, 0.25, 0.3, 8);
  const beamGeo = new THREE.ConeGeometry(2.4, 4.1, 16, 1, true);
  beamGeo.translate(0, -2.05, 0);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0.045,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const glowTex = makeGlowTexture();
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  // The static parts of every lamp are baked into one geometry per material: poles, heads and light cones are three
  // draw calls for the whole map instead of five per lamp. Only the glow sprites stay separate.
  const meshes: THREE.Object3D[] = [];
  const poleIds: BoxId[] = [];
  const poleParts: THREE.BufferGeometry[] = [];
  const headParts: THREE.BufferGeometry[] = [];
  const beamParts: THREE.BufferGeometry[] = [];
  const placed = (geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry => {
    const g = geo.clone();
    g.translate(x, y, z);
    return g;
  };
  for (const { x, z } of sites) {
    poleIds.push(
      world.add({
        min: { x: x - POLE_HALF, y: 0, z: z - POLE_HALF },
        max: { x: x + POLE_HALF, y: POLE_HEIGHT, z: z + POLE_HALF },
      }),
    );
    headParts.push(placed(headGeo, x, HEAD_Y, z));
    poleParts.push(
      placed(poleGeo, x, POLE_HEIGHT / 2, z),
      placed(baseGeo, x, 0.15, z),
      placed(armGeo, x, HEAD_Y - 0.05, z),
    );
    beamParts.push(placed(beamGeo, x, HEAD_Y - 0.1, z));
    const glow = new THREE.Sprite(glowMat);
    glow.position.set(x, GLOW_Y, z);
    glow.scale.setScalar(GLOW_SCALE);
    scene.add(glow);
    meshes.push(glow);
  }
  const mergedGeos: THREE.BufferGeometry[] = [];
  const addMerged = (parts: THREE.BufferGeometry[], mat: THREE.Material, shadow: boolean): void => {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts);
    for (const g of parts) g.dispose();
    mergedGeos.push(merged);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = shadow;
    freezeStatic(mesh);
    scene.add(mesh);
    meshes.push(mesh);
  };
  addMerged(headParts, headMat, false);
  addMerged(poleParts, poleMat, true);
  addMerged(beamParts, beamMat, false);

  let disposed = false;
  return {
    meshes,
    update(time: number): void {
      // A faint electrical flicker on the lamp heads, the glow and the light cone together.
      const f =
        1 +
        Math.sin(time * 37) * 0.025 +
        Math.sin(time * 11.3) * 0.03 +
        (Math.sin(time * 3.1) > 0.985 ? -0.25 : 0);
      headMat.emissiveIntensity = 2.2 * f;
      glowMat.opacity = Math.min(1, f);
      beamMat.opacity = 0.045 * f;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const id of poleIds) world.remove(id);
      for (const m of meshes) scene.remove(m);
      for (const g of mergedGeos) g.dispose();
      headGeo.dispose();
      poleGeo.dispose();
      poleMat.dispose();
      armGeo.dispose();
      baseGeo.dispose();
      beamGeo.dispose();
      beamMat.dispose();
      headMat.dispose();
      glowMat.dispose();
      glowTex.dispose();
    },
  };
}

// Legacy TEX_FX.glow (index.html:1117-1123): a 128 px radial gradient.
function makeGlowTexture(): THREE.CanvasTexture {
  return cachedTexture('lamp-glow', drawGlowTexture);
}

function drawGlowTexture(): THREE.CanvasTexture {
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
