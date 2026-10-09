import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/core/rng';
import { CollisionWorld, type Aabb } from '../../src/sim/collision';
import { lampPlacements } from '../../src/render/lamps';

const ZONES = [
  { x: -29, z: -28 },
  { x: 29, z: -28 },
  { x: 1, z: 22 },
];

function block(x0: number, z0: number, x1: number, z1: number): Aabb {
  return { min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: 3, z: z1 } };
}

describe('lampPlacements', () => {
  it('returns the requested count on an open map', () => {
    const world = new CollisionWorld();
    expect(lampPlacements(createRng(7), 6, world, [])).toHaveLength(6);
    expect(lampPlacements(createRng(7), 0, world, [])).toHaveLength(0);
  });

  it('keeps every lamp at least 10 m from every zone (legacy d2 < 100)', () => {
    const world = new CollisionWorld();
    const out = lampPlacements(createRng(7), 6, world, ZONES);
    expect(out).toHaveLength(6);
    for (const p of out) {
      for (const zd of ZONES) {
        expect((p.x - zd.x) ** 2 + (p.z - zd.z) ** 2).toBeGreaterThanOrEqual(100);
      }
    }
  });

  it('keeps every lamp inside the -48..48 square', () => {
    const world = new CollisionWorld();
    for (const p of lampPlacements(createRng(7), 6, world, ZONES)) {
      expect(p.x).toBeGreaterThanOrEqual(-48);
      expect(p.x).toBeLessThan(48);
      expect(p.z).toBeGreaterThanOrEqual(-48);
      expect(p.z).toBeLessThan(48);
    }
  });

  it('keeps every lamp clear of colliders by 1 m (pointFree with r = 1.0)', () => {
    const world = new CollisionWorld();
    world.add(block(-20, -20, 20, 20));
    const out = lampPlacements(createRng(7), 6, world, []);
    expect(out).toHaveLength(6);
    for (const p of out) {
      expect(world.pointFree(p.x, p.z, 1.0)).toBe(true);
      // Inside the box footprint expanded by 1 m there must be no lamp.
      expect(p.x > -21 && p.x < 21 && p.z > -21 && p.z < 21).toBe(false);
    }
  });

  it('gives no lamps when the whole area is blocked, and terminates', () => {
    const world = new CollisionWorld();
    world.add(block(-60, -60, 60, 60));
    expect(lampPlacements(createRng(7), 6, world, [])).toEqual([]);
  });

  it('keeps earlier lamps 1 m apart, as legacy does when each pole becomes a collider', () => {
    const world = new CollisionWorld();
    const out = lampPlacements(createRng(7), 6, world, []);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (a === undefined || b === undefined) throw new Error('index out of range');
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(1.0);
      }
    }
  });

  it('is deterministic for createRng(7)', () => {
    const world = new CollisionWorld();
    world.add(block(-10, -10, 10, 10));
    const a = lampPlacements(createRng(7), 6, world, ZONES);
    const b = lampPlacements(createRng(7), 6, world, ZONES);
    expect(a).toEqual(b);
  });
});
