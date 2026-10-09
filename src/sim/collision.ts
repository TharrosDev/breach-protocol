import type { Vec2, Vec3 } from '../core/math';

export type BoxId = number;

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

interface Entry {
  box: Aabb;
  breakable: boolean;
}

type Axis = 'x' | 'y' | 'z';
const AXES: readonly Axis[] = ['x', 'y', 'z'];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// Port of the legacy collision helpers (index.html:796-853). Boxes are axis-aligned;
// point tests and pushOut use the XZ footprint only, as the legacy game does.
export class CollisionWorld {
  private readonly boxes = new Map<BoxId, Entry>();
  private nextId = 0;

  add(box: Aabb, opts: { breakable?: boolean } = {}): BoxId {
    const id = this.nextId;
    this.nextId += 1;
    this.boxes.set(id, { box, breakable: opts.breakable ?? false });
    return id;
  }

  remove(id: BoxId): void {
    this.boxes.delete(id);
  }

  // Every registered box, in insertion order. Read-only use: callers must not mutate the boxes.
  footprints(): Aabb[] {
    return Array.from(this.boxes.values(), (entry) => entry.box);
  }

  // Pushes p (mutated in place) out of every box footprint to distance r. Two passes, as legacy moveCollide.
  pushOut(p: Vec2, r: number): void {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const { box } of this.boxes.values()) {
        pushOutOfBox(p, r, box);
      }
    }
  }

  // Slab test against every box; returns the nearest hit with t <= maxT. d is assumed normalised.
  raycast(
    o: Vec3,
    d: Vec3,
    maxT: number,
    opts: { onlyBreakable?: boolean } = {},
  ): { t: number; id: BoxId } | null {
    let best = Infinity;
    let hitId: BoxId | null = null;
    for (const [id, entry] of this.boxes) {
      if (opts.onlyBreakable === true && !entry.breakable) continue;
      const t = rayBox(o, d, entry.box);
      if (t < best && t <= maxT) {
        best = t;
        hitId = id;
      }
    }
    return hitId === null ? null : { t: best, id: hitId };
  }

  // True when a circle of radius r centred on (x, z) touches no box footprint.
  pointFree(x: number, z: number, r: number): boolean {
    for (const { box } of this.boxes.values()) {
      const cx = clamp(x, box.min.x, box.max.x);
      const cz = clamp(z, box.min.z, box.max.z);
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return false;
    }
    return true;
  }
}

function pushOutOfBox(p: Vec2, r: number, box: Aabb): void {
  const cx = clamp(p.x, box.min.x, box.max.x);
  const cz = clamp(p.z, box.min.z, box.max.z);
  const dx = p.x - cx;
  const dz = p.z - cz;
  const dd = dx * dx + dz * dz;
  if (dd >= r * r) return;
  if (dd > 1e-8) {
    const dist = Math.sqrt(dd);
    const k = (r - dist) / dist;
    p.x += dx * k;
    p.z += dz * k;
    return;
  }
  // Inside the footprint: eject along the axis of minimum depth.
  const left = p.x - box.min.x;
  const right = box.max.x - p.x;
  const back = p.z - box.min.z;
  const front = box.max.z - p.z;
  const m = Math.min(left, right, back, front);
  if (m === left) p.x = box.min.x - r;
  else if (m === right) p.x = box.max.x + r;
  else if (m === back) p.z = box.min.z - r;
  else p.z = box.max.z + r;
}

// Returns the entry distance t0 along the ray, or Infinity on a miss. A ray starting inside returns 0.
function rayBox(o: Vec3, d: Vec3, box: Aabb): number {
  let t0 = 0;
  let t1 = Infinity;
  for (const k of AXES) {
    const dk = d[k];
    const ok = o[k];
    if (Math.abs(dk) < 1e-9) {
      if (ok < box.min[k] || ok > box.max[k]) return Infinity;
    } else {
      let a = (box.min[k] - ok) / dk;
      let b = (box.max[k] - ok) / dk;
      if (a > b) {
        const tmp = a;
        a = b;
        b = tmp;
      }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}
