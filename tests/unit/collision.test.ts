import { describe, it, expect } from 'vitest';
import { CollisionWorld, type Aabb } from '../../src/sim/collision';

// Box spanning x 5..6, y 0..2, z -1..1.
function slabAtFive(): Aabb {
  return { min: { x: 5, y: 0, z: -1 }, max: { x: 6, y: 2, z: 1 } };
}

describe('CollisionWorld raycast', () => {
  it('a ray along +x from the origin hits a box at x = 5 with t = 5', () => {
    const world = new CollisionWorld();
    const id = world.add(slabAtFive());
    const hit = world.raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 100);
    expect(hit).not.toBeNull();
    expect(hit?.t).toBeCloseTo(5, 10);
    expect(hit?.id).toBe(id);
  });

  it('a ray parallel to a face and outside its slab misses', () => {
    const world = new CollisionWorld();
    world.add(slabAtFive());
    const hit = world.raycast({ x: 0, y: 1, z: 3 }, { x: 1, y: 0, z: 0 }, 100);
    expect(hit).toBeNull();
  });

  it('a ray starting inside a box returns t = 0', () => {
    const world = new CollisionWorld();
    const id = world.add(slabAtFive());
    const hit = world.raycast({ x: 5.5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 100);
    expect(hit).toEqual({ t: 0, id });
  });

  it('ignores a box beyond maxT', () => {
    const world = new CollisionWorld();
    world.add(slabAtFive());
    expect(world.raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 4)).toBeNull();
  });

  it('a removed box is no longer hit', () => {
    const world = new CollisionWorld();
    const id = world.add(slabAtFive());
    world.remove(id);
    expect(world.raycast({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 100)).toBeNull();
  });

  it('onlyBreakable skips unbreakable boxes', () => {
    const world = new CollisionWorld();
    world.add(slabAtFive());
    const breakableFar: Aabb = { min: { x: 10, y: 0, z: -1 }, max: { x: 11, y: 2, z: 1 } };
    const farId = world.add(breakableFar, { breakable: true });
    const origin = { x: 0, y: 1, z: 0 };
    const dir = { x: 1, y: 0, z: 0 };
    expect(world.raycast(origin, dir, 100)?.t).toBeCloseTo(5, 10);
    const hit = world.raycast(origin, dir, 100, { onlyBreakable: true });
    expect(hit?.id).toBe(farId);
    expect(hit?.t).toBeCloseTo(10, 10);
  });
});

describe('CollisionWorld pushOut', () => {
  it('moves a point outside a box edge to exactly distance r', () => {
    const world = new CollisionWorld();
    world.add({ min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 2, z: 4 } });
    const p = { x: -0.1, z: 2 };
    world.pushOut(p, 0.35);
    expect(p.x).toBeCloseTo(-0.35, 10);
    expect(p.z).toBeCloseTo(2, 10);
  });

  it('leaves a point that is already at least r away unchanged', () => {
    const world = new CollisionWorld();
    world.add({ min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 2, z: 4 } });
    const p = { x: -2, z: 2 };
    world.pushOut(p, 0.35);
    expect(p).toEqual({ x: -2, z: 2 });
  });

  it('pushes a point at a box centre out along the minimum-depth axis', () => {
    const world = new CollisionWorld();
    // Box x 0..10, z 0..4. Centre (5, 2): depth to z faces is 2, to x faces is 5.
    world.add({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 2, z: 4 } });
    const p = { x: 5, z: 2 };
    world.pushOut(p, 0.35);
    expect(p.x).toBeCloseTo(5, 10);
    expect(p.z).toBeCloseTo(-0.35, 10);
  });
});

describe('CollisionWorld pointFree', () => {
  it('is false within r of a box and true outside', () => {
    const world = new CollisionWorld();
    world.add({ min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 2, z: 4 } });
    expect(world.pointFree(2, 2, 0.35)).toBe(false);
    expect(world.pointFree(-0.2, 2, 0.35)).toBe(false);
    expect(world.pointFree(-0.5, 2, 0.35)).toBe(true);
    expect(world.pointFree(10, 10, 0.35)).toBe(true);
  });
});
