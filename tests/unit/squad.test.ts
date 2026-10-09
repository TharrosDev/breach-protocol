import { describe, it, expect } from 'vitest';
import { CollisionWorld } from '../../src/sim/collision';
import type { AiWorld, Enemy, PlayerView } from '../../src/sim/entities';
import type { NavGrid, PathBudget } from '../../src/sim/nav/types';
import { createRng } from '../../src/core/rng';
import {
  createOperator,
  killOperator,
  operatorAim,
  placeOperator,
  updOperator,
  type OperatorEvent,
} from '../../src/sim/squad';

// Straight-line movement only: every point is walkable and lineWalk always succeeds.
function fakeNav(): NavGrid {
  return {
    size: 120,
    rebuild: () => {},
    isWalk: () => true,
    lineWalk: () => true,
    findPath: () => [],
  };
}

const grantAll: PathBudget = { take: () => true };

function makePlayer(x: number, z: number, order: 0 | 1 | 2, alive = true): PlayerView {
  return { pos: { x, y: 0, z }, eyeHeight: 1.7, alive, moving: false, ghost: false, order };
}

function makeWorld(player: PlayerView, enemies: Enemy[] = [], collision = new CollisionWorld()): AiWorld {
  return {
    time: 0,
    player,
    enemies,
    operators: [],
    nav: fakeNav(),
    collision,
    smokes: [],
    zones: [],
    rng: createRng(7),
    pathBudget: grantAll,
    difficulty: { dmg: 1 },
  };
}

function makeEnemy(x: number, z: number): Enemy {
  return {
    kind: 'rifle',
    alive: true,
    hp: 100,
    maxHp: 100,
    pos: { x, z },
    yaw: 0,
    state: 'guard',
    home: null,
    lastSeen: null,
    sight: 0,
    role: 'flank',
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
    path: null,
    pathIdx: 0,
    pathT: 0,
    pathTx: 0,
    pathTz: 0,
    stuckT: 0,
    unstuck: 0,
    sideX: 0,
    sideZ: 0,
  };
}

function distance(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

describe('createOperator', () => {
  it('uses the legacy ally names and offsets', () => {
    const a1 = createOperator(0);
    expect(a1.name).toBe('Ally 1');
    expect(a1.ox).toBe(-3);
    expect(a1.oz).toBe(-2);
    expect(a1.alive).toBe(true);
    expect(a1.hp).toBe(100);
    expect(a1.maxHp).toBe(100);
    expect(a1.fireT).toBe(0);
    expect(a1.deathT).toBe(0);
    expect(a1.kills).toBe(0);
    expect(a1.reviveT).toBe(0);
    expect(a1.phase).toBe(0);

    const a2 = createOperator(1);
    expect(a2.name).toBe('Ally 2');
    expect(a2.ox).toBe(3);
    expect(a2.oz).toBe(-2);
  });

  it('draws the animation phase from the caller rng when one is given', () => {
    const phase = createOperator(0, createRng(3)).phase;
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(6);
  });
});

describe('placeOperator', () => {
  it('places the operator at the base plus its offset when the spot is clear', () => {
    const a = createOperator(0);
    placeOperator(a, { x: 10, z: 10 }, new CollisionWorld());
    expect(a.pos).toEqual({ x: 7, z: 8 });
  });

  it('falls back to the base point when a collider blocks the offset spot', () => {
    const collision = new CollisionWorld();
    collision.add({ min: { x: 6.5, y: 0, z: 7.5 }, max: { x: 7.5, y: 2, z: 8.5 } });
    const a = createOperator(0);
    placeOperator(a, { x: 10, z: 10 }, collision);
    expect(a.pos).toEqual({ x: 10, z: 10 });
  });
});

describe('killOperator and respawn', () => {
  it('sets alive false and starts the 20 s respawn timer', () => {
    const a = createOperator(0);
    killOperator(a);
    expect(a.alive).toBe(false);
    expect(a.deathT).toBe(20);
  });

  it('revives at the player offset after 20 s of dt', () => {
    const a = createOperator(0);
    killOperator(a);
    const w = makeWorld(makePlayer(5, 5, 0));
    for (let i = 0; i < 39; i++) {
      expect(updOperator(a, w, 0.5)).toEqual([]);
    }
    expect(a.alive).toBe(false);
    const events = updOperator(a, w, 0.5);
    expect(events).toEqual([]);
    expect(a.alive).toBe(true);
    expect(a.hp).toBe(a.maxHp);
    expect(a.pos).toEqual({ x: 2, z: 3 });
  });
});

describe('downed player', () => {
  it('approaches the downed player and emits revive after 2.5 s within 2.2 m', () => {
    const a = createOperator(0);
    a.pos = { x: 10, z: 0 };
    const w = makeWorld(makePlayer(0, 0, 0));
    const dt = 0.05;
    let inRange = 0;
    let revive: OperatorEvent | undefined;
    for (let i = 0; i < 400 && revive === undefined; i++) {
      const before = distance(a.pos.x, a.pos.z, 0, 0);
      const events = updOperator(a, w, dt, { playerDowned: true });
      if (before <= 2.2) inRange += dt;
      revive = events.find((e) => e.type === 'revive');
    }
    expect(revive).toEqual({ type: 'revive', by: a });
    expect(distance(a.pos.x, a.pos.z, 0, 0)).toBeLessThan(2.2);
    expect(inRange).toBeGreaterThanOrEqual(2.5 - 1e-9);
    expect(inRange).toBeLessThan(2.6);
    expect(a.reviveT).toBe(0);
  });
});

describe('firing', () => {
  it('emits one operatorFire event with a visible hostile and sets fireT positive', () => {
    const a = createOperator(0);
    a.pos = { x: 0, z: 0 };
    const enemy = makeEnemy(10, 0);
    const w = makeWorld(makePlayer(0, -5, 0), [enemy]);
    const events = updOperator(a, w, 0.016);
    expect(events).toHaveLength(1);
    const first = events[0];
    expect(first).toEqual({ type: 'operatorFire', operator: a, enemy });
    expect(a.fireT).toBeGreaterThan(0);
    expect(a.fireT).toBeLessThanOrEqual(0.19);
    // Cooldown holds: a second short update does not fire again.
    expect(updOperator(a, w, 0.01)).toEqual([]);
  });

  it('does not fire at a hostile blocked by a collider', () => {
    const a = createOperator(0);
    a.pos = { x: 0, z: 0 };
    const collision = new CollisionWorld();
    collision.add({ min: { x: 4, y: 0, z: -1 }, max: { x: 5, y: 3, z: 1 } });
    const w = makeWorld(makePlayer(0, -5, 0), [makeEnemy(10, 0)], collision);
    expect(updOperator(a, w, 0.016)).toEqual([]);
  });
});

describe('movement by order', () => {
  it('HOLD with no hostile does not move', () => {
    const a = createOperator(0);
    a.pos = { x: 0, z: 0 };
    const w = makeWorld(makePlayer(20, 0, 1));
    for (let i = 0; i < 20; i++) {
      expect(updOperator(a, w, 0.1)).toEqual([]);
    }
    expect(a.pos).toEqual({ x: 0, z: 0 });
    expect(a.moving).toBe(false);
  });

  it('FOLLOW with the player 10 m away moves toward the offset', () => {
    const a = createOperator(0);
    a.pos = { x: 0, z: 0 };
    // Offset for Ally 1 is (-3, -2), so the goal is (7, -2).
    const w = makeWorld(makePlayer(10, 0, 2));
    const startDist = distance(a.pos.x, a.pos.z, 7, -2);
    for (let i = 0; i < 10; i++) {
      updOperator(a, w, 0.1);
    }
    expect(distance(a.pos.x, a.pos.z, 7, -2)).toBeLessThan(startDist);
    expect(a.moving).toBe(true);
    expect(a.phase).toBeGreaterThan(0);
  });
});

describe('operatorAim', () => {
  it('returns a unit vector close to the direction of the enemy', () => {
    const a = createOperator(0);
    a.pos = { x: 0, z: 0 };
    const enemy = makeEnemy(20, 0);
    const aim = operatorAim(a, enemy, createRng(11));
    expect(Math.hypot(aim.x, aim.y, aim.z)).toBeCloseTo(1, 10);
    expect(aim.x).toBeGreaterThan(0.9);
  });
});
