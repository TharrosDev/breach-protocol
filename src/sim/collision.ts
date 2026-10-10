import type { Vec2, Vec3 } from '../core/math';

export type BoxId = number;

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

interface Entry {
  id: BoxId;
  box: Aabb;
  breakable: boolean;
  // Query stamp, so a box registered in several cells is tested once per raycast.
  seen: number;
}

type Axis = 'x' | 'y' | 'z';
const AXES: readonly Axis[] = ['x', 'y', 'z'];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// Uniform XZ broadphase. Boxes are registered in every cell within MARGIN of their footprint, so a point query only
// reads its own cell, and a ray walks the cells it crosses. Candidates are tested in insertion (id) order, so results
// match the plain loop over every box exactly. A box outside the grid bounds turns the grid off (plain loop).
const GRID_MIN = -80;
const GRID_MAX = 80;
const CELL = 4;
const CELLS_PER_SIDE = (GRID_MAX - GRID_MIN) / CELL;
// A point or push-out query may use a radius up to MARGIN - 1 and still read a single cell.
const MARGIN = 2.5;

const NO_OPTS: { onlyBreakable?: boolean } = {};

export interface CollisionOptions {
  // false turns the broadphase off, so a test can compare it with the plain loop.
  grid?: boolean;
}

// Port of the legacy collision helpers (index.html:796-853). Boxes are axis-aligned;
// point tests and pushOut use the XZ footprint only, as the legacy game does.
export class CollisionWorld {
  private readonly boxes = new Map<BoxId, Entry>();
  private nextId = 0;
  private readonly useGrid: boolean;
  private readonly cells: Entry[][] = [];
  private outliers = 0;
  private stamp = 0;

  constructor(opts: CollisionOptions = {}) {
    this.useGrid = opts.grid !== false;
    if (this.useGrid) {
      for (let i = 0; i < CELLS_PER_SIDE * CELLS_PER_SIDE; i += 1) this.cells.push([]);
    }
  }

  add(box: Aabb, opts: { breakable?: boolean } = {}): BoxId {
    const id = this.nextId;
    this.nextId += 1;
    const entry: Entry = { id, box, breakable: opts.breakable ?? false, seen: 0 };
    this.boxes.set(id, entry);
    if (this.useGrid) this.register(entry);
    return id;
  }

  remove(id: BoxId): void {
    const entry = this.boxes.get(id);
    if (entry === undefined) return;
    this.boxes.delete(id);
    if (!this.useGrid) return;
    if (this.isOutlier(entry.box)) {
      this.outliers -= 1;
      return;
    }
    this.forEachCell(entry.box, (cell) => {
      const i = cell.indexOf(entry);
      if (i >= 0) cell.splice(i, 1);
    });
  }

  // Every registered box, in insertion order. Read-only use: callers must not mutate the boxes.
  footprints(): Aabb[] {
    return Array.from(this.boxes.values(), (entry) => entry.box);
  }

  // Pushes p (mutated in place) out of every box footprint to distance r. Two passes, as legacy moveCollide.
  pushOut(p: Vec2, r: number): void {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const entry of this.nearby(p.x, p.z, r)) pushOutOfBox(p, r, entry.box);
    }
  }

  // Slab test against the boxes; returns the nearest hit with t <= maxT. d is assumed normalised.
  raycast(
    o: Vec3,
    d: Vec3,
    maxT: number,
    opts: { onlyBreakable?: boolean } = NO_OPTS,
  ): { t: number; id: BoxId } | null {
    const onlyBreakable = opts.onlyBreakable === true;
    if (
      !this.gridOn() ||
      !(maxT >= 0) ||
      o.x < GRID_MIN ||
      o.x >= GRID_MAX ||
      o.z < GRID_MIN ||
      o.z >= GRID_MAX
    ) {
      return this.raycastAll(o, d, maxT, onlyBreakable);
    }
    this.stamp += 1;
    const stamp = this.stamp;
    let best = Infinity;
    let hitId = -1;

    let cx = Math.floor((o.x - GRID_MIN) / CELL);
    let cz = Math.floor((o.z - GRID_MIN) / CELL);
    const stepX = d.x > 0 ? 1 : -1;
    const stepZ = d.z > 0 ? 1 : -1;
    const invX = Math.abs(d.x) < 1e-12 ? Infinity : 1 / Math.abs(d.x);
    const invZ = Math.abs(d.z) < 1e-12 ? Infinity : 1 / Math.abs(d.z);
    const edgeX = GRID_MIN + (cx + (stepX > 0 ? 1 : 0)) * CELL;
    const edgeZ = GRID_MIN + (cz + (stepZ > 0 ? 1 : 0)) * CELL;
    let tMaxX = invX === Infinity ? Infinity : Math.abs(edgeX - o.x) * invX;
    let tMaxZ = invZ === Infinity ? Infinity : Math.abs(edgeZ - o.z) * invZ;
    const dtX = CELL * invX;
    const dtZ = CELL * invZ;
    for (;;) {
      const cell = this.cells[cz * CELLS_PER_SIDE + cx];
      if (cell !== undefined) {
        for (const entry of cell) {
          if (entry.seen === stamp) continue;
          entry.seen = stamp;
          if (onlyBreakable && !entry.breakable) continue;
          const t = rayBox(o, d, entry.box);
          if (t <= maxT && (t < best || (t === best && entry.id < hitId))) {
            best = t;
            hitId = entry.id;
          }
        }
      }
      const exit = Math.min(tMaxX, tMaxZ);
      // Boxes not yet tested enter the ray in a later cell, so they cannot beat a hit found inside this one.
      if (best <= exit || exit > maxT) break;
      if (tMaxX < tMaxZ) {
        cx += stepX;
        tMaxX += dtX;
      } else {
        cz += stepZ;
        tMaxZ += dtZ;
      }
      if (cx < 0 || cz < 0 || cx >= CELLS_PER_SIDE || cz >= CELLS_PER_SIDE) break;
    }
    return hitId < 0 ? null : { t: best, id: hitId };
  }

  // True when a circle of radius r centred on (x, z) touches no box footprint.
  pointFree(x: number, z: number, r: number): boolean {
    for (const { box } of this.nearby(x, z, r)) {
      const cx = clamp(x, box.min.x, box.max.x);
      const cz = clamp(z, box.min.z, box.max.z);
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return false;
    }
    return true;
  }

  private gridOn(): boolean {
    return this.useGrid && this.outliers === 0;
  }

  private raycastAll(
    o: Vec3,
    d: Vec3,
    maxT: number,
    onlyBreakable: boolean,
  ): { t: number; id: BoxId } | null {
    let best = Infinity;
    let hitId: BoxId | null = null;
    for (const [id, entry] of this.boxes) {
      if (onlyBreakable && !entry.breakable) continue;
      const t = rayBox(o, d, entry.box);
      if (t < best && t <= maxT) {
        best = t;
        hitId = id;
      }
    }
    return hitId === null ? null : { t: best, id: hitId };
  }

  // The boxes that can touch a circle of radius r at (x, z), in id order. Every box when the grid cannot answer.
  private nearby(x: number, z: number, r: number): Iterable<Entry> {
    if (!this.gridOn() || r > MARGIN - 1 || x < GRID_MIN || x >= GRID_MAX || z < GRID_MIN || z >= GRID_MAX) {
      return this.boxes.values();
    }
    const cx = Math.floor((x - GRID_MIN) / CELL);
    const cz = Math.floor((z - GRID_MIN) / CELL);
    return this.cells[cz * CELLS_PER_SIDE + cx] ?? [];
  }

  private isOutlier(box: Aabb): boolean {
    return (
      box.min.x < GRID_MIN + MARGIN ||
      box.min.z < GRID_MIN + MARGIN ||
      box.max.x > GRID_MAX - MARGIN ||
      box.max.z > GRID_MAX - MARGIN
    );
  }

  private register(entry: Entry): void {
    if (this.isOutlier(entry.box)) {
      this.outliers += 1;
      return;
    }
    this.forEachCell(entry.box, (cell) => {
      cell.push(entry);
    });
  }

  private forEachCell(box: Aabb, fn: (cell: Entry[]) => void): void {
    const x0 = Math.max(0, Math.floor((box.min.x - MARGIN - GRID_MIN) / CELL));
    const x1 = Math.min(CELLS_PER_SIDE - 1, Math.floor((box.max.x + MARGIN - GRID_MIN) / CELL));
    const z0 = Math.max(0, Math.floor((box.min.z - MARGIN - GRID_MIN) / CELL));
    const z1 = Math.min(CELLS_PER_SIDE - 1, Math.floor((box.max.z + MARGIN - GRID_MIN) / CELL));
    for (let iz = z0; iz <= z1; iz += 1) {
      for (let ix = x0; ix <= x1; ix += 1) {
        const cell = this.cells[iz * CELLS_PER_SIDE + ix];
        if (cell !== undefined) fn(cell);
      }
    }
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
