import type { Vec2 } from '../../core/math';
import type { CollisionWorld } from '../collision';
import type { NavGrid, PathBudget } from './types';

// Walkable 1 m grid over the arena (legacy index.html:887-1002). Cell i covers x in [i - 60, i - 59).
const GN = 120;
const GO = 60;
const CELLS = GN * GN;
const BOX_REACH = 0.7; // bounding-box loop margin in buildGrid
const CENTRE_MARGIN = 0.6; // a cell is blocked when its centre lies this close to a box
const LINE_STEP = 0.5; // lineWalk sample spacing
const NEAREST_RADIUS = 6; // nearestWalkIndex search radius, in cells
const SEARCH_CAP = 8000; // A* pops per search
const DIAG_COST = 1.4142; // legacy value, kept for parity

const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, DIAG_COST],
  [1, -1, DIAG_COST],
  [-1, 1, DIAG_COST],
  [-1, -1, DIAG_COST],
];

function clampCell(v: number): number {
  return Math.min(Math.max(v, 0), GN - 1);
}

// Index of the cell containing (x, z), clamped to the grid edge.
export function cellOf(x: number, z: number): number {
  return clampCell(Math.floor(z + GO)) * GN + clampCell(Math.floor(x + GO));
}

interface HeapItem {
  readonly key: number;
  readonly val: number;
}

// Binary min-heap keyed on the A* priority (legacy heapPush/heapPop, index.html:914-945).
class MinHeap {
  private readonly items: HeapItem[] = [];

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }

  push(key: number, val: number): void {
    const items = this.items;
    items.push({ key, val });
    let i = items.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.keyAt(p) <= this.keyAt(i)) break;
      this.swap(p, i);
      i = p;
    }
  }

  // Removes and returns the smallest value, or undefined when empty.
  pop(): number | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (top === undefined || last === undefined) return undefined;
    if (items.length > 0) {
      items[0] = last;
      this.siftDown();
    }
    return top.val;
  }

  private siftDown(): void {
    const n = this.items.length;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.keyAt(l) < this.keyAt(m)) m = l;
      if (r < n && this.keyAt(r) < this.keyAt(m)) m = r;
      if (m === i) return;
      this.swap(m, i);
      i = m;
    }
  }

  private keyAt(i: number): number {
    return this.items[i]?.key ?? Infinity;
  }

  private swap(a: number, b: number): void {
    const x = this.items[a];
    const y = this.items[b];
    if (x === undefined || y === undefined) return;
    this.items[a] = y;
    this.items[b] = x;
  }
}

export class GridNav implements NavGrid {
  readonly size = GN;

  // 1 = walkable, 0 = blocked.
  private readonly walk = new Uint8Array(CELLS);

  // A* scratch arrays, reused across searches. A cell belongs to search `id` when stamp[c] === id.
  private readonly stamp = new Uint32Array(CELLS);
  private readonly closed = new Uint32Array(CELLS);
  private readonly g = new Float64Array(CELLS);
  private readonly parent = new Int32Array(CELLS);
  private readonly heap = new MinHeap();
  private searchId = 0;

  constructor(private readonly world: CollisionWorld) {
    this.rebuild();
  }

  // Re-reads the collision world. Call again after a breakable wall breaks.
  rebuild(): void {
    const walk = this.walk;
    walk.fill(1);
    for (const box of this.world.footprints()) {
      const x0 = Math.max(0, Math.floor(box.min.x + GO - BOX_REACH));
      const x1 = Math.min(GN - 1, Math.floor(box.max.x + GO + BOX_REACH));
      const z0 = Math.max(0, Math.floor(box.min.z + GO - BOX_REACH));
      const z1 = Math.min(GN - 1, Math.floor(box.max.z + GO + BOX_REACH));
      for (let iz = z0; iz <= z1; iz += 1) {
        for (let ix = x0; ix <= x1; ix += 1) {
          const cx = ix - GO + 0.5;
          const cz = iz - GO + 0.5;
          if (
            cx > box.min.x - CENTRE_MARGIN &&
            cx < box.max.x + CENTRE_MARGIN &&
            cz > box.min.z - CENTRE_MARGIN &&
            cz < box.max.z + CENTRE_MARGIN
          ) {
            walk[iz * GN + ix] = 0;
          }
        }
      }
    }
  }

  isWalk(x: number, z: number): boolean {
    return this.walk[cellOf(x, z)] === 1;
  }

  // True when every sample along the segment, at most LINE_STEP apart, is walkable.
  lineWalk(x0: number, z0: number, x1: number, z1: number): boolean {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / LINE_STEP);
    if (n === 0) return this.isWalk(x0, z0);
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      if (this.walk[cellOf(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)] !== 1) return false;
    }
    return true;
  }

  // Waypoints from start to target, excluding the start cell. [] when both share a cell,
  // null when there is no path or the budget is spent. Consumes one budget token per call.
  findPath(sx: number, sz: number, tx: number, tz: number, budget: PathBudget): Vec2[] | null {
    if (!budget.take()) return null;
    const s = this.nearestWalk(cellOf(sx, sz));
    const t = this.nearestWalk(cellOf(tx, tz));
    if (s < 0 || t < 0) return null;
    if (s === t) return [];
    return this.search(s, t);
  }

  // Index of the walkable cell nearest to idx within NEAREST_RADIUS, or -1.
  private nearestWalk(idx: number): number {
    if (this.walk[idx] === 1) return idx;
    const cx = idx % GN;
    const cz = Math.floor(idx / GN);
    for (let r = 1; r <= NEAREST_RADIUS; r += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= GN || z >= GN) continue;
          const j = z * GN + x;
          if (this.walk[j] === 1) return j;
        }
      }
    }
    return -1;
  }

  // A* over walkable cells from s to t. Returns cell-centre waypoints, or null.
  private search(s: number, t: number): Vec2[] | null {
    const { walk, stamp, closed, g, parent, heap } = this;
    this.searchId += 1;
    const id = this.searchId;

    const tcx = t % GN;
    const tcz = Math.floor(t / GN);
    const heuristic = (c: number): number => Math.hypot((c % GN) - tcx, Math.floor(c / GN) - tcz);

    heap.clear();
    stamp[s] = id;
    g[s] = 0;
    parent[s] = -1;
    heap.push(heuristic(s), s);

    let found = false;
    for (let iters = 0; heap.size > 0 && iters < SEARCH_CAP; iters += 1) {
      const cur = heap.pop();
      if (cur === undefined) break;
      if (closed[cur] === id) continue; // stale heap entry
      closed[cur] = id;
      if (cur === t) {
        found = true;
        break;
      }

      const cx = cur % GN;
      const cz = Math.floor(cur / GN);
      const cg = g[cur] ?? 0;
      for (const [dx, dz, cost] of NEIGHBOURS) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= GN || nz >= GN) continue;
        const n = nz * GN + nx;
        if (walk[n] !== 1 || closed[n] === id) continue;
        // No corner cutting: a diagonal step needs both orthogonal neighbours walkable.
        if (dx !== 0 && dz !== 0 && (walk[cz * GN + nx] !== 1 || walk[nz * GN + cx] !== 1)) {
          continue;
        }
        const ng = cg + cost;
        if (stamp[n] !== id || ng < (g[n] ?? Infinity)) {
          stamp[n] = id;
          g[n] = ng;
          parent[n] = cur;
          heap.push(ng + heuristic(n), n);
        }
      }
    }

    if (!found) return null;
    const out: Vec2[] = [];
    for (let c = t; c !== s && c >= 0; c = parent[c] ?? -1) {
      out.push({ x: (c % GN) - GO + 0.5, z: Math.floor(c / GN) - GO + 0.5 });
    }
    return out.reverse();
  }
}
