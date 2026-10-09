import { describe, it, expect } from 'vitest';
import { CollisionWorld, type Aabb } from '../../src/sim/collision';
import { GridNav } from '../../src/sim/nav/grid';
import type { PathBudget } from '../../src/sim/nav/types';

const OPEN: PathBudget = { take: () => true };

function box(x0: number, z0: number, x1: number, z1: number): Aabb {
  return { min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: 2, z: z1 } };
}

// Zero-size box whose inflated footprint covers exactly the cell centred on (i + 0.5, j + 0.5).
function cellBlock(i: number, j: number): Aabb {
  return box(i + 0.5, j + 0.5, i + 0.5, j + 0.5);
}

// Walls the 14 cells around the pocket A = (0, 0) and B = (1, 1), leaving A and B walkable.
// Cells listed in `open` are left walkable as well.
function pocketWorld(open: [number, number][]): CollisionWorld {
  const world = new CollisionWorld();
  for (let i = -1; i <= 2; i += 1) {
    for (let j = -1; j <= 2; j += 1) {
      if ((i === 0 && j === 0) || (i === 1 && j === 1)) continue;
      if (open.some(([oi, oj]) => oi === i && oj === j)) continue;
      world.add(cellBlock(i, j));
    }
  }
  return world;
}

describe('GridNav', () => {
  it('an empty world has every cell walkable', () => {
    const nav = new GridNav(new CollisionWorld());
    expect(nav.size).toBe(120);
    for (let i = 0; i < 120; i += 1) {
      for (let j = 0; j < 120; j += 1) {
        expect(nav.isWalk(i - 60 + 0.5, j - 60 + 0.5)).toBe(true);
      }
    }
  });

  it('a wall blocks the cells its centre-inflated footprint covers', () => {
    const world = new CollisionWorld();
    world.add(box(0, 0, 2, 1));
    const nav = new GridNav(world);
    // Footprint x 0..2, z 0..1, inflated by 0.6 on cell centres.
    expect(nav.isWalk(0.5, 0.5)).toBe(false);
    expect(nav.isWalk(-0.5, 0.5)).toBe(false);
    expect(nav.isWalk(2.5, 0.5)).toBe(false);
    expect(nav.isWalk(0.5, 1.5)).toBe(false);
    expect(nav.isWalk(0.5, -0.5)).toBe(false);
    expect(nav.isWalk(-1.5, 0.5)).toBe(true);
    expect(nav.isWalk(3.5, 0.5)).toBe(true);
    expect(nav.isWalk(0.5, -1.5)).toBe(true);
    expect(nav.isWalk(0.5, 2.5)).toBe(true);
  });

  it('findPath goes around a wall and every waypoint is walkable', () => {
    const world = new CollisionWorld();
    world.add(box(-5, 0, 5, 1));
    const nav = new GridNav(world);
    const path = nav.findPath(0.5, -5.5, 0.5, 5.5, OPEN);
    expect(path).not.toBeNull();
    const waypoints = path ?? [];
    expect(waypoints.length).toBeGreaterThan(0);
    expect(waypoints[waypoints.length - 1]).toEqual({ x: 0.5, z: 5.5 });
    for (const p of waypoints) {
      expect(nav.isWalk(p.x, p.z)).toBe(true);
    }
    // The wall blocks x centres up to 5.5, so the route must pass a column at x = 6.5 or -6.5.
    expect(waypoints.some((p) => Math.abs(p.x) >= 6.5)).toBe(true);
  });

  it('findPath returns null when the target is enclosed by walls', () => {
    const walls = [box(-3, 2, 3, 3), box(-3, -3, 3, -2), box(-3, -2, -2, 2), box(2, -2, 3, 2)];
    const world = new CollisionWorld();
    for (const w of walls) world.add(w);
    const nav = new GridNav(world);
    expect(nav.findPath(-10.5, -10.5, 0.5, 0.5, OPEN)).toBeNull();
  });

  it('findPath reaches the same target once the enclosure has a gap', () => {
    // Same ring as above with the north wall removed.
    const world = new CollisionWorld();
    world.add(box(-3, -3, 3, -2));
    world.add(box(-3, -2, -2, 2));
    world.add(box(2, -2, 3, 2));
    const nav = new GridNav(world);
    expect(nav.findPath(-10.5, -10.5, 0.5, 0.5, OPEN)).not.toBeNull();
  });

  it('findPath returns [] for a target in the same cell', () => {
    const nav = new GridNav(new CollisionWorld());
    expect(nav.findPath(0.2, 0.2, 0.8, 0.7, OPEN)).toEqual([]);
  });

  it('lineWalk is false across a wall and true on open ground', () => {
    const world = new CollisionWorld();
    world.add(box(0, -5, 1, 5));
    const nav = new GridNav(world);
    expect(nav.lineWalk(-5, 0, 5, 0)).toBe(false);
    expect(nav.lineWalk(-5, 8, 5, 8)).toBe(true);
  });

  it('a budget that refuses returns null, and each call takes one token', () => {
    const nav = new GridNav(new CollisionWorld());
    expect(nav.findPath(0.5, 0.5, 5.5, 5.5, { take: () => false })).toBeNull();

    let calls = 0;
    const counting: PathBudget = {
      take: () => {
        calls += 1;
        return true;
      },
    };
    expect(nav.findPath(0.5, 0.5, 5.5, 5.5, counting)).not.toBeNull();
    expect(calls).toBe(1);
  });

  it('rebuild after removing a box makes its cells walkable again', () => {
    const world = new CollisionWorld();
    const id = world.add(box(0, 0, 2, 1));
    const nav = new GridNav(world);
    expect(nav.isWalk(0.5, 0.5)).toBe(false);

    world.remove(id);
    expect(nav.isWalk(0.5, 0.5)).toBe(false); // stale until rebuild
    nav.rebuild();
    expect(nav.isWalk(0.5, 0.5)).toBe(true);
  });

  it('refuses a diagonal step when both orthogonal neighbours are blocked', () => {
    // A = (0.5, 0.5) and B = (1.5, 1.5) are walkable but sealed off from each other except diagonally.
    const nav = new GridNav(pocketWorld([]));
    expect(nav.findPath(0.5, 0.5, 1.5, 1.5, OPEN)).toBeNull();
  });

  it('refuses a diagonal step when one orthogonal neighbour is blocked', () => {
    const nav = new GridNav(pocketWorld([[1, 0]]));
    expect(nav.findPath(0.5, 0.5, 1.5, 1.5, OPEN)).toEqual([
      { x: 1.5, z: 0.5 },
      { x: 1.5, z: 1.5 },
    ]);
  });

  it('takes the diagonal step when both orthogonal neighbours are walkable', () => {
    const nav = new GridNav(
      pocketWorld([
        [1, 0],
        [0, 1],
      ]),
    );
    expect(nav.findPath(0.5, 0.5, 1.5, 1.5, OPEN)).toEqual([{ x: 1.5, z: 1.5 }]);
  });
});
