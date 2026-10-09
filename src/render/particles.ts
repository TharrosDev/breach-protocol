import * as THREE from 'three';
import type { Vec3 } from '../core/math';
import { createRng, type Rng } from '../core/rng';

// Particle pool ported from the legacy burst and update (index.html:1384-1429). Same constants and the
// same draw order, so a seeded Rng gives the legacy spread. The class has no THREE dependency; only
// buildParticles touches the scene.

const PARK_Y = -1000;
const FLOOR_Y = 0.02;
const GRAVITY = 9;
const DRAG_RATE = 2.5;
const BOUNCE = -0.2;
const POINT_SIZE = 0.13;

// Used only when a caller does not pass an Rng. Fixed seed, so the module never touches Math.random.
const fallbackRng = createRng(1);

function read(a: Float32Array, i: number): number {
  return a[i] ?? 0;
}

// THREE.Color(hex) converts sRGB to the linear working space. Legacy colours went through it, so do the same here.
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export class ParticlePool {
  // Interleaved xyz. Dead slots are parked at y = -1000 with colour 0.
  readonly positions: Float32Array;
  readonly colors: Float32Array;

  private readonly velocities: Float32Array;
  private readonly base: Float32Array;
  private readonly life: Float32Array;
  private readonly lifeMax: Float32Array;
  private readonly capacity: number;
  private next = 0;
  private live = 0;

  constructor(max = 500) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError('ParticlePool max must be a positive integer');
    }
    this.capacity = max;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.velocities = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.lifeMax = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      this.positions[i * 3 + 1] = PARK_Y;
    }
  }

  // Number of particles with life left.
  get alive(): number {
    return this.live;
  }

  // Ring buffer: when full, the oldest slot is overwritten. A non-positive life emits nothing.
  emitBurst(p: Vec3, n: number, speed: number, hex: number, life: number, up = 0, rng?: Rng): void {
    if (!(life > 0)) return;
    const r = rng ?? fallbackRng;
    const cr = srgbToLinear(((hex >> 16) & 0xff) / 255);
    const cg = srgbToLinear(((hex >> 8) & 0xff) / 255);
    const cb = srgbToLinear((hex & 0xff) / 255);

    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;

      const a = r.next() * Math.PI * 2;
      const u = r.next() * 2 - 1;
      const ring = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + r.next() * 0.6);
      const j = i * 3;

      this.positions[j] = p.x;
      this.positions[j + 1] = p.y;
      this.positions[j + 2] = p.z;
      this.velocities[j] = Math.cos(a) * ring * s;
      this.velocities[j + 1] = u * s + up;
      this.velocities[j + 2] = Math.sin(a) * ring * s;
      this.base[j] = cr;
      this.base[j + 1] = cg;
      this.base[j + 2] = cb;
      this.colors[j] = cr;
      this.colors[j + 1] = cg;
      this.colors[j + 2] = cb;

      if (read(this.life, i) <= 0) this.live++;
      this.life[i] = life;
      this.lifeMax[i] = life;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      const life = read(this.life, i);
      if (life <= 0) continue;

      const j = i * 3;
      const remaining = life - dt;
      if (remaining <= 0) {
        this.life[i] = 0;
        this.positions[j + 1] = PARK_Y;
        this.colors[j] = 0;
        this.colors[j + 1] = 0;
        this.colors[j + 2] = 0;
        this.live--;
        continue;
      }
      this.life[i] = remaining;

      const drag = Math.max(0, 1 - dt * DRAG_RATE);
      // Gravity, then drag on all three components, then integrate with the dragged velocity (legacy order).
      const vx = read(this.velocities, j) * drag;
      let vy = (read(this.velocities, j + 1) - GRAVITY * dt) * drag;
      const vz = read(this.velocities, j + 2) * drag;

      const x = read(this.positions, j) + vx * dt;
      let y = read(this.positions, j + 1) + vy * dt;
      const z = read(this.positions, j + 2) + vz * dt;
      if (y < FLOOR_Y) {
        y = FLOOR_Y;
        vy *= BOUNCE;
      }

      this.positions[j] = x;
      this.positions[j + 1] = y;
      this.positions[j + 2] = z;
      this.velocities[j] = vx;
      this.velocities[j + 1] = vy;
      this.velocities[j + 2] = vz;

      const f = remaining / read(this.lifeMax, i);
      this.colors[j] = read(this.base, j) * f;
      this.colors[j + 1] = read(this.base, j + 1) * f;
      this.colors[j + 2] = read(this.base, j + 2) * f;
    }
  }
}

// Points object sharing the pool's typed arrays, so sync() only flags them for upload.
export function buildParticles(
  scene: THREE.Scene,
  pool: ParticlePool,
): { object: THREE.Points; sync(): void } {
  const position = new THREE.BufferAttribute(pool.positions, 3).setUsage(THREE.DynamicDrawUsage);
  const color = new THREE.BufferAttribute(pool.colors, 3).setUsage(THREE.DynamicDrawUsage);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', color);

  const material = new THREE.PointsMaterial({
    size: POINT_SIZE,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });

  const object = new THREE.Points(geometry, material);
  object.frustumCulled = false;
  scene.add(object);

  return {
    object,
    sync(): void {
      position.needsUpdate = true;
      color.needsUpdate = true;
    },
  };
}
