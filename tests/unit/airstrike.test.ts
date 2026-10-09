import { describe, it, expect } from 'vitest';
import type { Rng } from '../../src/core/rng';
import { createRng } from '../../src/core/rng';
import type { EnemyKindId } from '../../src/content/enemies';
import { CollisionWorld } from '../../src/sim/collision';
import type { Enemy } from '../../src/sim/entities';
import { createAirstrike, stepAirstrike } from '../../src/sim/airstrike';

// Rng that always returns the midpoint, so every blast lands exactly on the aim point.
const midRng: Rng = {
  next: () => 0.5,
  range: (a, b) => (a + b) / 2,
  pick: <T>(items: readonly T[]): T => items[0] as T,
  fork: () => midRng,
};

function makeEnemy(kind: EnemyKindId, x: number, z: number, hp: number): Enemy {
  return {
    path: null,
    pathIdx: 0,
    pathT: 0,
    pathTx: 0,
    pathTz: 0,
    stuckT: 0,
    unstuck: 0,
    sideX: 0,
    sideZ: 0,
    kind,
    alive: true,
    hp,
    maxHp: hp,
    pos: { x, z },
    yaw: 0,
    state: 'guard',
    home: null,
    lastSeen: null,
    sight: 50,
    role: 'push',
    flankSide: 1,
    fireT: 0,
    blind: 0,
    coverT: 0,
    grenT: 0,
    cover: null,
    engaged: false,
    unseenT: 0,
    flinchT: 0,
    strafeT: 0,
    strafeDir: 1,
    moving: false,
    phase: 0,
    deathT: 0,
    spot: 0,
    gx: 0,
    gz: 0,
    kick: 0,
    crouch: 0,
  };
}

describe('airstrike timing', () => {
  it('fires five blasts at 300, 560, 820, 1080 and 1340 ms, then reports done', () => {
    const rng = createRng(1);
    const world = new CollisionWorld();
    const state = createAirstrike({ x: 0, z: 0 });
    // dt = 0.01 s is exactly 10 ms in the accumulator, so the due times land on whole steps.
    const stepsWithBlast: number[] = [];
    const blastsPerStep: number[] = [];
    for (let step = 1; step <= 140; step += 1) {
      const out = stepAirstrike(state, 0.01, [], world, rng, null);
      if (out.blasts.length > 0) {
        stepsWithBlast.push(step);
        blastsPerStep.push(out.blasts.length);
      }
      if (step === 133) expect(state.done).toBe(false);
    }

    // Step n is at n * 10 ms: 30 -> 300, 56 -> 560, 82 -> 820, 108 -> 1080, 134 -> 1340.
    expect(stepsWithBlast).toEqual([30, 56, 82, 108, 134]);
    expect(blastsPerStep).toEqual([1, 1, 1, 1, 1]);
    expect(state.fired).toBe(5);
    expect(state.done).toBe(true);
  });

  it('emits every due blast when one step covers several', () => {
    const rng = createRng(1);
    const world = new CollisionWorld();
    const state = createAirstrike({ x: 0, z: 0 });
    // 1.1 s covers the 300, 560, 820 and 1080 ms blasts in one call.
    const out = stepAirstrike(state, 1.1, [], world, rng, null);
    expect(out.blasts).toHaveLength(4);
    expect(state.fired).toBe(4);
    expect(state.done).toBe(false);
  });

  it('returns nothing once done', () => {
    const rng = createRng(1);
    const world = new CollisionWorld();
    const state = createAirstrike({ x: 0, z: 0 });
    stepAirstrike(state, 2, [], world, rng, null);
    expect(state.done).toBe(true);
    expect(stepAirstrike(state, 1, [], world, rng, null).blasts).toHaveLength(0);
  });

  it('lands every blast within 6 m of the aim point on x and z', () => {
    const rng = createRng(7);
    const world = new CollisionWorld();
    const state = createAirstrike({ x: 20, z: -5 });
    const out = stepAirstrike(state, 2, [], world, rng, null);
    expect(out.blasts).toHaveLength(5);
    for (const b of out.blasts) {
      expect(b.radius).toBe(5);
      expect(b.at.y).toBe(0.3);
      expect(Math.abs(b.at.x - 20)).toBeLessThanOrEqual(6);
      expect(Math.abs(b.at.z + 5)).toBeLessThanOrEqual(6);
    }
  });
});

describe('airstrike blast damage', () => {
  it('damages an enemy at the blast centre by the falloff value', () => {
    const world = new CollisionWorld();
    const state = createAirstrike({ x: 0, z: 0 });
    const enemy = makeEnemy('rifle', 0, 0, 1000);
    // The blast is at y 0.3 and the body centre at y 1, so distance 0.7 m: 130 * (1 - 0.7 / 5).
    stepAirstrike(state, 0.3, [enemy], world, midRng, null);
    expect(1000 - enemy.hp).toBeCloseTo(130 * (1 - 0.7 / 5), 6);
  });

  it('does nothing beyond radius 5 and reports a kill for an enemy it finishes', () => {
    const world = new CollisionWorld();
    const state = createAirstrike({ x: 0, z: 0 });
    const near = makeEnemy('rifle', 0, 0, 50);
    const far = makeEnemy('rifle', 6, 0, 1000);
    const out = stepAirstrike(state, 0.3, [near, far], world, midRng, null);
    expect(far.hp).toBe(1000);
    expect(near.alive).toBe(false);
    expect(out.enemyKills).toEqual([near]);
  });

  it('gives the player falloff damage inside the radius and none outside', () => {
    const world = new CollisionWorld();
    const inside = createAirstrike({ x: 0, z: 0 });
    const outStep = stepAirstrike(inside, 0.3, [], world, midRng, { x: 0, y: 0, z: 0 });
    // Player centre is 1 m above the feet: distance 0.7 m from the blast.
    expect(outStep.playerDamage).toBeCloseTo(70 * (1 - 0.7 / 5), 6);

    const far = createAirstrike({ x: 0, z: 0 });
    const farStep = stepAirstrike(far, 0.3, [], world, midRng, { x: 10, y: 0, z: 0 });
    expect(farStep.playerDamage).toBe(0);

    const down = createAirstrike({ x: 0, z: 0 });
    const downStep = stepAirstrike(down, 0.3, [], world, midRng, null);
    expect(downStep.playerDamage).toBe(0);
  });

  it('is blocked by a world box between the blast and the enemy', () => {
    const world = new CollisionWorld();
    world.add({ min: { x: 1, y: 0, z: -1 }, max: { x: 1.5, y: 3, z: 1 } });
    const state = createAirstrike({ x: 0, z: 0 });
    const enemy = makeEnemy('rifle', 3, 0, 1000);
    stepAirstrike(state, 0.3, [enemy], world, midRng, null);
    expect(enemy.hp).toBe(1000);
  });
});
