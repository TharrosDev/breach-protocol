import { describe, it, expect } from 'vitest';
import { CollisionWorld } from '../../src/sim/collision';
import type { Enemy } from '../../src/sim/entities';
import type { EnemyKindId } from '../../src/content/enemies';
import { createBreach, plantBreach, stepBreach, BREACH_CHARGES, ARM_TIME } from '../../src/sim/breach';

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

// A reinforced wall face at x = 2 to 3, facing the player at the origin.
function wallWorld(): { world: CollisionWorld; wall: number } {
  const world = new CollisionWorld();
  const wall = world.add({ min: { x: 2, y: 0, z: -2 }, max: { x: 3, y: 4, z: 2 } }, { breakable: true });
  return { world, wall };
}

const EYE = { x: 0, y: 1.5, z: 0 };
const AIM = { x: 1, y: 0, z: 0 };

describe('plantBreach', () => {
  it('plants on a breakable box within 3.2 m of the aim ray', () => {
    const { world, wall } = wallWorld();
    const state = createBreach();
    const r = plantBreach(state, EYE, AIM, world);
    expect(r.planted).toBe(true);
    expect(r.box).toBe(wall);
    expect(r.point).toEqual({ x: 2, y: 1.5, z: 0 });
    expect(state.charges).toBe(BREACH_CHARGES - 1);
    expect(state.plant?.t).toBe(ARM_TIME);
  });

  it('does not plant on a box beyond 3.2 m', () => {
    const world = new CollisionWorld();
    world.add({ min: { x: 4, y: 0, z: -2 }, max: { x: 5, y: 4, z: 2 } }, { breakable: true });
    const state = createBreach();
    expect(plantBreach(state, EYE, AIM, world)).toEqual({ planted: false });
    expect(state.charges).toBe(2);
  });

  it('does not plant on a box that is not breakable', () => {
    const world = new CollisionWorld();
    world.add({ min: { x: 2, y: 0, z: -2 }, max: { x: 3, y: 4, z: 2 } });
    const state = createBreach();
    expect(plantBreach(state, EYE, AIM, world).planted).toBe(false);
  });

  it('allows two charges per life and refuses a third, and only one armed at a time', () => {
    const { world } = wallWorld();
    const state = createBreach();
    expect(plantBreach(state, EYE, AIM, world).planted).toBe(true);
    expect(plantBreach(state, EYE, AIM, world).planted).toBe(false);
    stepBreach(state, ARM_TIME, world, [], { x: 50, y: 0, z: 50 });
    expect(state.charges).toBe(1);

    // The first blast removed its wall, so the second charge needs a new reinforced face.
    world.add({ min: { x: 2, y: 0, z: -2 }, max: { x: 3, y: 4, z: 2 } }, { breakable: true });
    expect(plantBreach(state, EYE, AIM, world).planted).toBe(true);
    stepBreach(state, ARM_TIME, world, [], { x: 50, y: 0, z: 50 });
    expect(state.charges).toBe(0);

    world.add({ min: { x: 2, y: 0, z: -2 }, max: { x: 3, y: 4, z: 2 } }, { breakable: true });
    expect(plantBreach(state, EYE, AIM, world).planted).toBe(false);
  });
});

describe('stepBreach', () => {
  it('explodes after 2.2 s, removes the box and damages a nearby enemy', () => {
    const { world, wall } = wallWorld();
    const state = createBreach();
    plantBreach(state, EYE, AIM, world);
    // Enemy at (2.5, 0): 0.5 m from the charge point (2, 0) in XZ.
    const enemy = makeEnemy('rifle', 2.5, 0, 200);
    const player = { x: 50, y: 0, z: 50 };

    const early = stepBreach(state, 2, world, [enemy], player);
    expect(early).toEqual({ exploded: false, enemyKills: [], playerDamage: 0 });
    expect(enemy.hp).toBe(200);

    // 2.2 - 2 leaves 0.2 of arming time, so a 0.25 s step is past the fuse.
    const r = stepBreach(state, 0.25, world, [enemy], player);
    expect(r.exploded).toBe(true);
    expect(r.brokenBox).toBe(wall);
    expect(world.raycast(EYE, AIM, 10)).toBeNull();
    // 110 * (1 - 0.5 / 4.5)
    expect(enemy.hp).toBeCloseTo(200 - 110 * (1 - 0.5 / 4.5), 9);
    expect(r.enemyKills).toEqual([]);
    expect(state.plant).toBeNull();
  });

  it('kills an enemy that the blast finishes and reports it', () => {
    const { world } = wallWorld();
    const state = createBreach();
    plantBreach(state, EYE, AIM, world);
    const enemy = makeEnemy('rifle', 2, 0, 50);
    const r = stepBreach(state, ARM_TIME, world, [enemy], { x: 50, y: 0, z: 50 });
    expect(enemy.alive).toBe(false);
    expect(r.enemyKills).toEqual([enemy]);
  });

  it('ignores enemies beyond 4.5 m and dead enemies', () => {
    const { world } = wallWorld();
    const state = createBreach();
    plantBreach(state, EYE, AIM, world);
    const far = makeEnemy('rifle', 2, 5, 200);
    const dead = makeEnemy('rifle', 2, 0, 200);
    dead.alive = false;
    stepBreach(state, ARM_TIME, world, [far, dead], { x: 50, y: 0, z: 50 });
    expect(far.hp).toBe(200);
    expect(dead.hp).toBe(200);
  });

  it('returns 60 * (1 - d / 4.5) to a player at the centre, and nothing outside 4.5 m', () => {
    const { world } = wallWorld();
    const state = createBreach();
    plantBreach(state, EYE, AIM, world);
    const r = stepBreach(state, ARM_TIME, world, [], { x: 2, y: 0, z: 0 });
    expect(r.playerDamage).toBeCloseTo(60, 9);

    const { world: w2 } = wallWorld();
    const s2 = createBreach();
    plantBreach(s2, EYE, AIM, w2);
    const far = stepBreach(s2, ARM_TIME, w2, [], { x: 7, y: 0, z: 0 });
    expect(far.playerDamage).toBe(0);
  });

  it('is a no-op with nothing armed', () => {
    const world = new CollisionWorld();
    expect(stepBreach(createBreach(), 1, world, [], { x: 0, y: 0, z: 0 })).toEqual({
      exploded: false,
      enemyKills: [],
      playerDamage: 0,
    });
  });
});
