import { describe, it, expect } from 'vitest';
import type { Rng } from '../../src/core/rng';
import { CollisionWorld, type Aabb } from '../../src/sim/collision';
import type { Enemy, Target } from '../../src/sim/entities';
import type { EnemyKindId } from '../../src/content/enemies';
import { DIFF } from '../../src/content/difficulty';
import { damageEnemy, nearestEnemyHit, resolveEnemyShot } from '../../src/sim/combat';

// Rng that always returns the midpoint, so spread offsets are exactly zero.
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

const PLAYER: Target = { kind: 'player' };
const VETERAN = DIFF.veteran;
const EYE_Y = 1.6;

describe('resolveEnemyShot', () => {
  it('hits a player standing 10 m in front, dead centre, for the full rifle damage', () => {
    const shooter = makeEnemy('rifle', 0, 0, 60);
    const world = new CollisionWorld();
    // Body centre y = feet (0) + eye * 0.6.
    const aim = { x: 0, y: EYE_Y * 0.6, z: 10 };
    const out = resolveEnemyShot(
      shooter,
      { target: PLAYER, aim, spread: 0 },
      { x: 0, y: 0, z: 10 },
      true,
      world,
      midRng,
      VETERAN,
      EYE_Y,
    );
    expect(out.hit).toBe(true);
    expect(out.damage).toBeCloseTo(8, 10);
    expect(out.end.z).toBeGreaterThan(9);
    expect(out.end.z).toBeLessThan(10);
  });

  it('misses when a wall stands between shooter and player', () => {
    const shooter = makeEnemy('rifle', 0, 0, 60);
    const world = new CollisionWorld();
    const wall: Aabb = { min: { x: -1, y: 0, z: 5 }, max: { x: 1, y: 4, z: 5.5 } };
    world.add(wall);
    const aim = { x: 0, y: EYE_Y * 0.6, z: 10 };
    const out = resolveEnemyShot(
      shooter,
      { target: PLAYER, aim, spread: 0 },
      { x: 0, y: 0, z: 10 },
      true,
      world,
      midRng,
      VETERAN,
      EYE_Y,
    );
    expect(out.hit).toBe(false);
    expect(out.damage).toBe(0);
    expect(out.end.z).toBeGreaterThan(4.9);
    expect(out.end.z).toBeLessThan(5.6);
  });

  it('scales damage to 70% beyond 30 m', () => {
    const shooter = makeEnemy('rifle', 0, 0, 60);
    const aim = { x: 0, y: EYE_Y * 0.6, z: 40 };
    const out = resolveEnemyShot(
      shooter,
      { target: PLAYER, aim, spread: 0 },
      { x: 0, y: 0, z: 40 },
      true,
      new CollisionWorld(),
      midRng,
      VETERAN,
      EYE_Y,
    );
    expect(out.hit).toBe(true);
    expect(out.damage).toBeCloseTo(8 * 0.7, 10);
  });

  it('always draws a tracer for a sniper', () => {
    const shooter = makeEnemy('sniper', 0, 0, 55);
    const aim = { x: 0, y: 0.95, z: 20 };
    const out = resolveEnemyShot(
      shooter,
      { target: { kind: 'operator', index: 0 }, aim, spread: 0 },
      { x: 0, y: 0, z: 20 },
      false,
      new CollisionWorld(),
      midRng,
      VETERAN,
      EYE_Y,
    );
    expect(out.tracer).toBe(true);
  });
});

describe('damageEnemy', () => {
  it('a player headshot kill scores 150 and costs one enemy ticket', () => {
    const e = makeEnemy('rifle', 0, 0, 60);
    const out = damageEnemy(e, 100, true, 'player');
    expect(out).toEqual({ killed: true, scoreDelta: 150, ticketDelta: 1, headshot: true });
    expect(e.alive).toBe(false);
    expect(e.deathT).toBe(4);
  });

  it('a body kill by the player scores 100', () => {
    const e = makeEnemy('rifle', 0, 0, 60);
    expect(damageEnemy(e, 100, false, 'player').scoreDelta).toBe(100);
  });

  it('an operator kill scores nothing for the player but still costs a ticket', () => {
    const e = makeEnemy('rifle', 0, 0, 60);
    const out = damageEnemy(e, 100, false, 'operator');
    expect(out.killed).toBe(true);
    expect(out.scoreDelta).toBe(0);
    expect(out.ticketDelta).toBe(1);
  });

  it('heavy non-head damage is multiplied by 0.6', () => {
    const e = makeEnemy('heavy', 0, 0, 150);
    const out = damageEnemy(e, 100, false, 'player');
    expect(out.killed).toBe(false);
    expect(e.hp).toBeCloseTo(150 - 60, 10);
    expect(out.ticketDelta).toBe(0);
  });

  it('heavy head damage is not reduced', () => {
    const e = makeEnemy('heavy', 0, 0, 150);
    damageEnemy(e, 100, true, 'player');
    expect(e.hp).toBeCloseTo(50, 10);
  });

  it('does nothing to an enemy that is already dead', () => {
    const e = makeEnemy('rifle', 0, 0, 60);
    e.alive = false;
    expect(damageEnemy(e, 100, true, 'player')).toEqual({
      killed: false,
      scoreDelta: 0,
      ticketDelta: 0,
      headshot: false,
    });
    expect(e.hp).toBe(60);
  });
});

describe('nearestEnemyHit', () => {
  it('returns the nearer of two enemies along the ray', () => {
    const near = makeEnemy('rifle', 0, 5, 60);
    const far = makeEnemy('rifle', 0, 12, 60);
    const hit = nearestEnemyHit({ x: 0, y: 0.95, z: 0 }, { x: 0, y: 0, z: 1 }, 100, [far, near]);
    expect(hit).not.toBeNull();
    expect(hit?.enemy).toBe(near);
    expect(hit?.head).toBe(false);
  });

  it('returns null when no living enemy lies on the ray', () => {
    const side = makeEnemy('rifle', 5, 5, 60);
    expect(nearestEnemyHit({ x: 0, y: 0.95, z: 0 }, { x: 0, y: 0, z: 1 }, 100, [side])).toBeNull();
  });
});
