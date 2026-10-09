import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MAP_IDS, type MapId } from '../../src/content/ids';
import { MAPS, getMap } from '../../src/content/maps';
import { createRng } from '../../src/core/rng';
import { CollisionWorld } from '../../src/sim/collision';
import { buildMap, buildingRects, type BuildingRect, type MapHandle } from '../../src/render/map-builder';

// Map invariants from spec §5, run for both maps over several seeds.
// The walkable-grid check uses a 1 m grid over the whole map (-60..60), cell blocked when a 0.4 m circle at its
// centre touches a collider.

const SEEDS = [1, 7, 42];
const CASES: [MapId, number][] = MAP_IDS.flatMap((id): [MapId, number][] => SEEDS.map((seed) => [id, seed]));

// Legacy prop placement rules (index.html:806-812 areaFree and 1076-1084 pickups).
const PROP_ZONE_CLEARANCE = 9;
const PICKUP_ZONE_CLEARANCE = 12;
const SPAWN_CLEARANCE = 1.5;
const NAV_RADIUS = 0.4;
const DOOR_CLEARANCE = 0.35;
const FACE_TOLERANCE = 0.5;

interface Built {
  handle: MapHandle;
  world: CollisionWorld;
  scene: THREE.Scene;
  rects: BuildingRect[];
}

function build(id: MapId, seed: number): Built {
  const scene = new THREE.Scene();
  const world = new CollisionWorld();
  const handle = buildMap(getMap(id), scene, world, createRng(seed));
  return { handle, world, scene, rects: buildingRects(handle.def) };
}

const N = 120;
const GRID_HALF = 60;

// Formats a point for failure messages.
function at(x: number, z: number): string {
  return `(${String(x)}, ${String(z)})`;
}

function cellCentre(i: number): number {
  return -GRID_HALF + 0.5 + i;
}

function cellOf(v: number): number {
  return Math.min(N - 1, Math.max(0, Math.floor(v + GRID_HALF)));
}

function cellIndex(i: number, j: number): number {
  return i * N + j;
}

function walkableGrid(world: CollisionWorld): Uint8Array {
  const grid = new Uint8Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      grid[cellIndex(i, j)] = world.pointFree(cellCentre(i), cellCentre(j), NAV_RADIUS) ? 1 : 0;
    }
  }
  return grid;
}

// 4-connected flood fill from one walkable cell. Returns the reached cells.
function reachableFrom(grid: Uint8Array, start: number): Uint8Array {
  const seen = new Uint8Array(N * N);
  seen[start] = 1;
  const stack: number[] = [start];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    const i = Math.floor(cur / N);
    const j = cur % N;
    const next: [number, number][] = [
      [i - 1, j],
      [i + 1, j],
      [i, j - 1],
      [i, j + 1],
    ];
    for (const [ni, nj] of next) {
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const k = cellIndex(ni, nj);
      if (seen[k] === 1 || grid[k] !== 1) continue;
      seen[k] = 1;
      stack.push(k);
    }
  }
  return seen;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

// Distance from a point to the outline of a building rectangle (not its filled area).
function distToPerimeter(px: number, pz: number, r: BuildingRect): number {
  return Math.min(
    distToSegment(px, pz, r.x0, r.z0, r.x1, r.z0),
    distToSegment(px, pz, r.x1, r.z0, r.x1, r.z1),
    distToSegment(px, pz, r.x1, r.z1, r.x0, r.z1),
    distToSegment(px, pz, r.x0, r.z1, r.x0, r.z0),
  );
}

describe('map registry', () => {
  it('MAPS has exactly one entry per MapId, keyed by its own id', () => {
    expect(Object.keys(MAPS).sort()).toEqual([...MAP_IDS].sort());
    for (const id of MAP_IDS) expect(MAPS[id].id).toBe(id);
  });

  it('getMap returns the registry entry for each id', () => {
    for (const id of MAP_IDS) expect(getMap(id)).toBe(MAPS[id]);
  });
});

describe.each(CASES)('map %s, seed %i', (id, seed) => {
  const { handle, world, rects } = build(id, seed);
  const { def, spawns, zones, crates, sandbags, barrels, pickups } = handle;

  it('places the requested number of props', () => {
    expect(crates).toHaveLength(def.crates);
    expect(sandbags).toHaveLength(def.sandbags);
    expect(barrels).toHaveLength(def.barrels);
    expect(pickups).toHaveLength(6);
    expect(spawns.length).toBeGreaterThan(0);
  });

  // Invariant (a): no spawn inside a collider.
  it('every spawn is clear by 1.5 m', () => {
    for (const s of spawns) {
      expect(world.pointFree(s.x, s.z, SPAWN_CLEARANCE), `spawn at ${at(s.x, s.z)}`).toBe(true);
    }
  });

  // Invariant (b): no prop within 9 m of a zone centre. Pickups keep 12 m (index.html:1080).
  it('no prop lies within 9 m of a zone centre, and pickups keep 12 m', () => {
    const props = [...crates, ...sandbags, ...barrels];
    for (const p of props) {
      for (const z of zones) {
        expect(
          Math.hypot(p.x - z.x, p.z - z.z),
          `prop at ${at(p.x, p.z)} near ${z.name}`,
        ).toBeGreaterThanOrEqual(PROP_ZONE_CLEARANCE);
      }
    }
    for (const p of pickups) {
      for (const z of zones) {
        expect(
          Math.hypot(p.x - z.x, p.z - z.z),
          `pickup at ${at(p.x, p.z)} near ${z.name}`,
        ).toBeGreaterThanOrEqual(PICKUP_ZONE_CLEARANCE);
      }
    }
  });

  // Invariant (c): every zone centre reachable from every spawn on the 1 m grid.
  it('every zone centre is reachable from every spawn on a 1 m grid', () => {
    const grid = walkableGrid(world);
    for (const s of spawns) {
      const start = cellIndex(cellOf(s.x), cellOf(s.z));
      expect(grid[start], `spawn cell for ${at(s.x, s.z)} is walkable`).toBe(1);
      const seen = reachableFrom(grid, start);
      for (const z of zones) {
        const target = cellIndex(cellOf(z.x), cellOf(z.z));
        expect(seen[target] === 1, `${z.name} reachable from spawn ${at(s.x, s.z)}`).toBe(true);
      }
    }
  });

  // Invariant (d): breachable walls sit on building faces (every corner within 0.5 m of one building outline).
  it('breachable walls lie on building faces', () => {
    const breakable = def.boxes.filter((b) => b.breakable);
    expect(breakable.length).toBeGreaterThan(0);
    for (const b of breakable) {
      const corners: [number, number][] = [
        [b.min.x, b.min.z],
        [b.max.x, b.min.z],
        [b.max.x, b.max.z],
        [b.min.x, b.max.z],
      ];
      const onFace = rects.some((r) => corners.every(([x, z]) => distToPerimeter(x, z, r) <= FACE_TOLERANCE));
      expect(onFace, `breachable box at ${at(b.min.x, b.min.z)}`).toBe(true);
    }
  });

  // Invariant (e): each building has one door gap, and a point in it at the door centre is clear.
  it('each building has one passable door gap', () => {
    for (const r of rects) {
      const cx = (r.x0 + r.x1) / 2;
      const cz = (r.z0 + r.z1) / 2;
      // Side midpoints on the wall centreline. A wall covers its midpoint, a door gap does not.
      const sides: [string, number, number][] = [
        ['N', cx, r.z0],
        ['S', cx, r.z1],
        ['W', r.x0, cz],
        ['E', r.x1, cz],
      ];
      const open = sides.filter(([, x, z]) => world.pointFree(x, z, 1e-6));
      expect(open, `building ${at(r.x0, r.z0)} to ${at(r.x1, r.z1)}`).toHaveLength(1);
      const door = open[0];
      if (door === undefined) continue;
      expect(world.pointFree(door[1], door[2], DOOR_CLEARANCE), `door ${door[0]} gap`).toBe(true);
    }
  });
});

describe('map builder determinism', () => {
  it('Compound with createRng(1) places the same props on every build', () => {
    const a = build('compound', 1).handle;
    const b = build('compound', 1).handle;
    expect(b.crates).toEqual(a.crates);
    expect(b.sandbags).toEqual(a.sandbags);
    expect(b.barrels).toEqual(a.barrels);
    expect(b.pickups).toEqual(a.pickups);
    expect(b.spawns).toEqual(a.spawns);
  });

  it('a different seed places the crates differently', () => {
    const a = build('compound', 1).handle;
    const b = build('compound', 2).handle;
    expect(b.crates).not.toEqual(a.crates);
  });
});

describe.each(MAP_IDS)('map %s dispose', (id) => {
  it('removes every collider and object that buildMap added', () => {
    const { handle, world, scene } = build(id, 1);
    // Inside the boundary wall at z = -60 (index.html:1043): blocked while the map is built.
    expect(world.pointFree(0, -60, 0.01)).toBe(false);
    handle.dispose();
    expect(world.pointFree(0, -60, 0.01)).toBe(true);
    expect(scene.children).toHaveLength(0);
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
  });
});
