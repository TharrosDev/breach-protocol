import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getMap } from '../../src/content/maps';
import { createRng } from '../../src/core/rng';
import { CollisionWorld } from '../../src/sim/collision';
import { GridNav } from '../../src/sim/nav/grid';
import type { PathBudget } from '../../src/sim/nav/types';
import { buildMap } from '../../src/render/map-builder';

// Phase 3 gate: navigation on the Compound map. Colliders, spawns and zones all come from the real map build,
// so the grid sees the same props the game sees.

const UNLIMITED: PathBudget = { take: () => true };

function compoundWorld(): {
  world: CollisionWorld;
  spawns: { x: number; z: number }[];
  zones: { x: number; z: number }[];
} {
  const world = new CollisionWorld();
  const handle = buildMap(getMap('compound'), new THREE.Scene(), world, createRng(1));
  return { world, spawns: handle.spawns, zones: handle.zones };
}

describe('GridNav on Compound', () => {
  it('every collider box centre is not walkable', () => {
    const { world } = compoundWorld();
    const nav = new GridNav(world);
    const boxes = world.footprints();
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      expect(nav.isWalk(cx, cz), `box centre (${String(cx)}, ${String(cz)})`).toBe(false);
    }
  });

  it('an A* path exists from every spawn point to every zone', () => {
    const { world, spawns, zones } = compoundWorld();
    const nav = new GridNav(world);
    expect(spawns.length).toBeGreaterThan(0);
    expect(zones.length).toBe(3);
    for (const s of spawns) {
      for (const z of zones) {
        const path = nav.findPath(s.x, s.z, z.x, z.z, UNLIMITED);
        expect(
          path,
          `spawn (${String(s.x)}, ${String(s.z)}) to zone (${String(z.x)}, ${String(z.z)})`,
        ).not.toBeNull();
      }
    }
  });
});
