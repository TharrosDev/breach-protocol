// Impact, blood and explosion effects. One hub owns the particle pools, the puff sprites (fireball, smoke, dust)
// and the short explosion light. Counts follow the quality profile, so Low stays cheap.
import * as THREE from 'three';
import type { Vec3 } from '../core/math';
import type { Rng } from '../core/rng';
import { ParticlePool, buildParticles } from './particles';
import { makeSoftDotTexture } from './fx-assets';
import type { QualityProfile } from './quality';

export type SurfaceKind = 'concrete' | 'dirt' | 'wood' | 'metal' | 'sand';

interface SurfaceLook {
  spark: { n: number; hex: number; speed: number };
  dust: { hex: number; n: number; size: number };
  chips: { n: number; hex: number } | null;
}

const LOOKS: Record<SurfaceKind, SurfaceLook> = {
  concrete: {
    spark: { n: 4, hex: 0xffd9a0, speed: 3.2 },
    dust: { hex: 0xa29c90, n: 3, size: 0.5 },
    chips: { n: 3, hex: 0x8b867b },
  },
  dirt: {
    spark: { n: 0, hex: 0xffd9a0, speed: 2 },
    dust: { hex: 0x76634a, n: 4, size: 0.6 },
    chips: { n: 3, hex: 0x4a3d2c },
  },
  wood: {
    spark: { n: 1, hex: 0xffd9a0, speed: 2.4 },
    dust: { hex: 0xb99a6a, n: 2, size: 0.4 },
    chips: { n: 6, hex: 0xc19b64 },
  },
  metal: {
    spark: { n: 12, hex: 0xffe2a0, speed: 4.6 },
    dust: { hex: 0x77777a, n: 1, size: 0.3 },
    chips: null,
  },
  sand: {
    spark: { n: 0, hex: 0xffd9a0, speed: 2 },
    dust: { hex: 0xcdb883, n: 5, size: 0.7 },
    chips: { n: 2, hex: 0xb49a6a },
  },
};

interface Footprint {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

export interface SurfaceHints {
  barrels: readonly { x: number; z: number; r: number }[];
  crates: readonly Footprint[];
  sandbags: readonly Footprint[];
}

// Guesses the material of the thing that was hit from where it is: floor is dirt, barrels are metal, the props are
// sandbags and crates, and everything else is wall concrete.
export function classifySurface(p: Vec3, hints: SurfaceHints | null): SurfaceKind {
  if (p.y < 0.12) return 'dirt';
  if (hints) {
    for (const b of hints.barrels) if (Math.hypot(p.x - b.x, p.z - b.z) < b.r + 0.15) return 'metal';
    const inside = (f: Footprint): boolean =>
      Math.abs(p.x - f.x) <= f.w / 2 + 0.15 && Math.abs(p.z - f.z) <= f.d / 2 + 0.15 && p.y <= f.h + 0.1;
    for (const s of hints.sandbags) if (inside(s)) return 'sand';
    for (const c of hints.crates) if (inside(c)) return 'wood';
  }
  return 'concrete';
}

type PuffKind = 'fire' | 'smoke' | 'dust' | 'flash';

interface Puff {
  sprite: THREE.Sprite;
  kind: PuffKind;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size0: number;
  size1: number;
  opacity: number;
  grow: number;
}

const EMBER = new THREE.Color(0x5a1a08);
const FIRE_MAX = 28;
const SMOKE_MAX = 40;

export interface FxHub {
  // A bullet hit on the world. dir is the bullet direction.
  impact(p: Vec3, dir: Vec3, surface: SurfaceKind): void;
  // Blood spray at a body. dir is the bullet direction (the spray goes with it).
  blood(p: Vec3, dir: Vec3 | null, head: boolean): void;
  // A full explosion: fireball, flash, sparks, smoke and a light. radius in metres.
  explosion(p: Vec3, radius: number): void;
  // A tiny bright flash where a bullet strikes, for a frame or two.
  update(dt: number): void;
  dispose(): void;
}

export function createFxHub(scene: THREE.Scene, profile: QualityProfile, rng: Rng): FxHub {
  const dot = makeSoftDotTexture(0);
  const scale = profile.particleScale;
  const sparks = new ParticlePool(Math.round(600 * scale) + 80);
  const sparkView = buildParticles(scene, sparks, { size: 0.09, additive: true, map: dot });
  const chips = new ParticlePool(Math.round(260 * scale) + 40);
  const chipView = buildParticles(scene, chips, { size: 0.07, map: null });
  const blood = new ParticlePool(Math.round(260 * scale) + 40);
  const bloodView = buildParticles(scene, blood, { size: 0.11, map: dot });
  const embers = new ParticlePool(Math.round(240 * scale) + 40);
  const emberView = buildParticles(scene, embers, { size: 0.16, additive: true, map: dot });

  const puffs: Puff[] = [];
  const makePuff = (additive: boolean): Puff => {
    const mat = new THREE.SpriteMaterial({
      map: dot,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: !additive,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    scene.add(sprite);
    return {
      sprite,
      kind: additive ? 'fire' : 'smoke',
      vel: new THREE.Vector3(),
      age: 0,
      life: 1,
      size0: 1,
      size1: 1,
      opacity: 1,
      grow: 1,
    };
  };
  const additivePool: Puff[] = [];
  const normalPool: Puff[] = [];
  for (let i = 0; i < FIRE_MAX + 10; i++) additivePool.push(makePuff(true));
  for (let i = 0; i < SMOKE_MAX + 20; i++) normalPool.push(makePuff(false));

  const spawnPuff = (
    kind: PuffKind,
    p: Vec3,
    vel: Vec3,
    life: number,
    size0: number,
    size1: number,
    colour: number,
    opacity: number,
  ): void => {
    const pool = kind === 'fire' || kind === 'flash' ? additivePool : normalPool;
    const puff = pool.pop();
    if (!puff) return;
    puff.kind = kind;
    puff.sprite.position.set(p.x, p.y, p.z);
    puff.vel.set(vel.x, vel.y, vel.z);
    puff.age = 0;
    puff.life = life;
    puff.size0 = size0;
    puff.size1 = size1;
    puff.opacity = opacity;
    puff.sprite.visible = true;
    puff.sprite.material.color.setHex(colour);
    puffs.push(puff);
  };

  // Explosion light: a single point light that is moved and faded, High only.
  let light: THREE.PointLight | null = null;
  let lightT = 0;
  let lightPeak = 0;
  if (profile.dynamicLights) {
    light = new THREE.PointLight(0xffa050, 0, 26, 2);
    scene.add(light);
  }

  const emit = (
    pool: ParticlePool,
    p: Vec3,
    n: number,
    speed: number,
    hex: number,
    life: number,
    up: number,
  ): void => {
    const count = Math.max(0, Math.round(n * scale));
    if (count > 0) pool.emitBurst(p, count, speed, hex, life, up, rng);
  };

  return {
    impact(p, dir, surface) {
      const look = LOOKS[surface];
      // Sparks fly back along the bullet's reverse direction with some scatter.
      const away = { x: p.x - dir.x * 0.05, y: p.y - dir.y * 0.05, z: p.z - dir.z * 0.05 };
      emit(sparks, away, look.spark.n, look.spark.speed, look.spark.hex, 0.35, 0.6);
      if (look.chips) emit(chips, away, look.chips.n, 2.6, look.chips.hex, 0.55, 1.2);
      // A little cloud of dust that drifts and fades.
      const dn = Math.max(1, Math.round(look.dust.n * scale));
      for (let i = 0; i < dn; i++) {
        spawnPuff(
          'dust',
          { x: p.x - dir.x * 0.1, y: p.y - dir.y * 0.1, z: p.z - dir.z * 0.1 },
          {
            x: -dir.x * 0.5 + rng.range(-0.3, 0.3),
            y: 0.35 + rng.next() * 0.4,
            z: -dir.z * 0.5 + rng.range(-0.3, 0.3),
          },
          0.5 + rng.next() * 0.35,
          0.12,
          look.dust.size * (0.6 + rng.next() * 0.5),
          look.dust.hex,
          0.45,
        );
      }
      if (surface === 'metal') {
        spawnPuff('flash', away, { x: 0, y: 0, z: 0 }, 0.07, 0.34, 0.1, 0xffe9b0, 0.9);
      }
    },

    blood(p, dir, head) {
      const n = head ? 16 : 9;
      const up = 0.8;
      emit(blood, p, n, 2.4, 0x8a1212, 0.55, up);
      emit(blood, p, Math.round(n * 0.4), 1.2, 0xc0221c, 0.35, up + 0.4);
      if (dir) {
        // A forward spray through the body.
        emit(
          blood,
          { x: p.x + dir.x * 0.3, y: p.y + dir.y * 0.3, z: p.z + dir.z * 0.3 },
          5,
          3.4,
          0x7a0f0f,
          0.4,
          0.2,
        );
      }
      if (head) spawnPuff('dust', p, { x: 0, y: 0.5, z: 0 }, 0.5, 0.15, 0.5, 0xa01818, 0.4);
    },

    explosion(p, radius) {
      const core = { x: p.x, y: Math.max(0.6, p.y), z: p.z };
      spawnPuff('flash', core, { x: 0, y: 0, z: 0 }, 0.16, radius * 0.5, radius * 1.2, 0xfff0c0, 1);
      const fires = Math.max(2, Math.min(FIRE_MAX, Math.round(profile.explosionPuffs * 0.7)));
      for (let i = 0; i < fires; i++) {
        const a = rng.next() * Math.PI * 2;
        const r = rng.next() * radius * 0.35;
        spawnPuff(
          'fire',
          { x: core.x + Math.cos(a) * r, y: core.y + rng.next() * 0.7, z: core.z + Math.sin(a) * r },
          { x: Math.cos(a) * 1.5, y: 1.4 + rng.next() * 2.2, z: Math.sin(a) * 1.5 },
          0.45 + rng.next() * 0.35,
          radius * 0.22,
          radius * (0.5 + rng.next() * 0.35),
          rng.next() < 0.5 ? 0xff8a30 : 0xffc060,
          0.9,
        );
      }
      const smokes = Math.max(2, Math.min(SMOKE_MAX, profile.explosionPuffs));
      for (let i = 0; i < smokes; i++) {
        const a = rng.next() * Math.PI * 2;
        const r = rng.next() * radius * 0.5;
        spawnPuff(
          'smoke',
          { x: core.x + Math.cos(a) * r, y: core.y + rng.next(), z: core.z + Math.sin(a) * r },
          { x: Math.cos(a) * 1.2, y: 1.2 + rng.next() * 1.6, z: Math.sin(a) * 1.2 },
          1.6 + rng.next() * 1.4,
          radius * 0.25,
          radius * (0.7 + rng.next() * 0.6),
          rng.next() < 0.5 ? 0x2a2824 : 0x4a4640,
          0.7,
        );
      }
      emit(sparks, core, 70, radius * 1.4, 0xffb060, 0.9, 3);
      emit(embers, core, 30, radius * 0.7, 0xff6a20, 1.4, 5);
      emit(chips, core, 40, radius * 1.1, 0x4a3d2c, 1.0, 4);
      if (light) {
        light.position.set(core.x, core.y + 1, core.z);
        lightPeak = 90 + radius * 8;
        lightT = 0.55;
        light.intensity = lightPeak;
      }
    },

    update(dt) {
      sparks.update(dt);
      chips.update(dt);
      blood.update(dt);
      embers.update(dt);
      sparkView.sync();
      chipView.sync();
      bloodView.sync();
      emberView.sync();

      for (let i = puffs.length - 1; i >= 0; i--) {
        const puff = puffs[i];
        if (!puff) continue;
        puff.age += dt;
        const k = puff.age / puff.life;
        if (k >= 1) {
          puff.sprite.visible = false;
          puffs.splice(i, 1);
          (puff.kind === 'fire' || puff.kind === 'flash' ? additivePool : normalPool).push(puff);
          continue;
        }
        puff.sprite.position.x += puff.vel.x * dt;
        puff.sprite.position.y += puff.vel.y * dt;
        puff.sprite.position.z += puff.vel.z * dt;
        // Drag and, for smoke, a slow buoyant rise.
        const drag = Math.max(0, 1 - dt * (puff.kind === 'smoke' ? 1.2 : 2.4));
        puff.vel.multiplyScalar(drag);
        if (puff.kind === 'smoke') puff.vel.y += dt * 0.5;
        const eased = 1 - (1 - k) * (1 - k);
        const size = puff.size0 + (puff.size1 - puff.size0) * eased;
        puff.sprite.scale.set(size, size, 1);
        const fade =
          puff.kind === 'fire' || puff.kind === 'flash' ? 1 - k : k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
        const m = puff.sprite.material;
        m.opacity = puff.opacity * Math.max(0, fade);
        if (puff.kind === 'fire') m.color.lerp(EMBER, dt * 2.2);
      }

      if (light && lightT > 0) {
        lightT = Math.max(0, lightT - dt);
        light.intensity = lightPeak * (lightT / 0.55) ** 2;
      }
    },

    dispose() {
      for (const puff of [...puffs, ...additivePool, ...normalPool]) {
        scene.remove(puff.sprite);
        puff.sprite.material.dispose();
      }
      puffs.length = 0;
      additivePool.length = 0;
      normalPool.length = 0;
      if (light) scene.remove(light);
      dot?.dispose();
    },
  };
}
