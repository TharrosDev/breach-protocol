import type { Vec3 } from '../core/math';
import type { Rng } from '../core/rng';

// Shell casings ported from the legacy ejectCasing and updCasings (index.html:1431-1453).
// spin is the accumulated rotation about y. The field is pure; no mesh builder is provided yet.

export interface Casing {
  pos: Vec3;
  vel: Vec3;
  spin: number;
  life: number;
}

const DEFAULT_MAX = 24;
const LIFE = 1.4;
const GRAVITY = 12;
const FLOOR_Y = 0.02;
const BOUNCE_Y = -0.3;
const FRICTION = 0.6;
const SPIN_RATE = 9;
// Ejection point relative to the eye: 0.18 m to the right, 0.12 m below.
const SIDE_OFFSET = 0.18;
const DROP = -0.12;

export class CasingField {
  private casings: Casing[] = [];
  readonly capacity: number;

  constructor(max = DEFAULT_MAX) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError('CasingField max must be a positive integer');
    }
    this.capacity = max;
  }

  get items(): readonly Casing[] {
    return this.casings;
  }

  // yaw follows the legacy convention: the right-hand direction is (-cos yaw, sin yaw) on the ground plane.
  eject(origin: Vec3, yaw: number, rng: Rng): void {
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    const pos = {
      x: origin.x + rx * SIDE_OFFSET,
      y: origin.y + DROP,
      z: origin.z + rz * SIDE_OFFSET,
    };
    // Draw order matches legacy: x, then y, then z.
    const vx = rx * (1.6 + rng.next());
    const vy = 1.8 + rng.next() * 0.8;
    const vz = rz * (1.6 + rng.next());
    this.casings.push({ pos, vel: { x: vx, y: vy, z: vz }, spin: 0, life: LIFE });
    if (this.casings.length > this.capacity) {
      this.casings.splice(0, this.casings.length - this.capacity);
    }
  }

  update(dt: number): void {
    let w = 0;
    for (const c of this.casings) {
      c.life -= dt;
      c.vel.y -= GRAVITY * dt;
      c.pos.x += c.vel.x * dt;
      c.pos.y += c.vel.y * dt;
      c.pos.z += c.vel.z * dt;
      c.spin += dt * SPIN_RATE;
      if (c.pos.y < FLOOR_Y) {
        c.pos.y = FLOOR_Y;
        c.vel.y *= BOUNCE_Y;
        c.vel.x *= FRICTION;
        c.vel.z *= FRICTION;
      }
      if (c.life > 0) this.casings[w++] = c;
    }
    this.casings.length = w;
  }
}
