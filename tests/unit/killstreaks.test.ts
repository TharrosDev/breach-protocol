import { describe, it, expect } from 'vitest';
import type { EnemyKindId } from '../../src/content/enemies';
import type { Enemy } from '../../src/sim/entities';
import {
  awardKillstreak,
  checkStreakAward,
  createUav,
  readyLabel,
  spendKillstreak,
  stepUav,
  takeKillstreak,
  type KillstreakSlot,
} from '../../src/sim/killstreaks';

function makeEnemy(kind: EnemyKindId, x: number, z: number, alive = true): Enemy {
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
    alive,
    hp: 60,
    maxHp: 60,
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

const EMPTY: KillstreakSlot = { ks: null, ksUsed: 0 };

describe('checkStreakAward', () => {
  it('awards uav at 3, shield at 4, sentry at 5, airstrike at 7 and emp at 9', () => {
    expect(checkStreakAward(4)).toBe('shield');
    expect(checkStreakAward(9)).toBe('emp');
    expect(checkStreakAward(3)).toBe('uav');
    expect(checkStreakAward(5)).toBe('sentry');
    expect(checkStreakAward(7)).toBe('airstrike');
  });

  it('awards nothing at other streak counts', () => {
    for (const n of [0, 1, 2, 6, 8, 10, 11]) {
      expect(checkStreakAward(n)).toBeNull();
    }
  });
});

describe('readyLabel', () => {
  it('gives the legacy names', () => {
    expect(readyLabel('uav')).toBe('UAV');
    expect(readyLabel('sentry')).toBe('Sentry Turret');
    expect(readyLabel('airstrike')).toBe('Airstrike');
  });
});

describe('killstreak slot', () => {
  it('stores an award in an empty slot', () => {
    expect(awardKillstreak(EMPTY, 3)).toEqual({ ks: 'uav', ksUsed: 0 });
  });

  it('keeps the held killstreak when a new award arrives', () => {
    const held: KillstreakSlot = { ks: 'uav', ksUsed: 0 };
    expect(awardKillstreak(held, 5)).toEqual({ ks: 'uav', ksUsed: 0 });
  });

  it('ignores a streak count that awards nothing', () => {
    expect(awardKillstreak(EMPTY, 6)).toEqual(EMPTY);
  });

  it('takes the held killstreak without changing the slot', () => {
    expect(takeKillstreak({ ks: 'sentry', ksUsed: 2 })).toEqual({ id: 'sentry' });
    expect(takeKillstreak(EMPTY)).toBeNull();
  });

  it('spends the slot and counts one use', () => {
    expect(spendKillstreak({ ks: 'airstrike', ksUsed: 1 })).toEqual({ ks: null, ksUsed: 2 });
  });
});

describe('UAV', () => {
  it('starts with UAV_TIME (20 s) of life', () => {
    expect(createUav().t).toBe(20);
  });

  it('holds every living enemy spotted for 20 s, then stops', () => {
    const uav = createUav();
    const alive = makeEnemy('rifle', 0, 0);
    const dead = makeEnemy('rifle', 5, 5, false);
    const enemies = [alive, dead];

    // Spots are decremented elsewhere each frame, so reset them before each step.
    // dt = 0.5 keeps the countdown exact in binary: 40 frames is 20 s.
    let spottedFrames = 0;
    for (let frame = 0; frame < 40; frame += 1) {
      alive.spot = 0;
      dead.spot = 0;
      stepUav(uav, enemies, 0.5);
      if (alive.spot === 0.3) spottedFrames += 1;
      expect(dead.spot).toBe(0);
    }
    expect(spottedFrames).toBe(40);
    expect(uav.t).toBe(0);

    // After 20 s the UAV is down: no more spotting.
    alive.spot = 0;
    stepUav(uav, enemies, 0.5);
    expect(alive.spot).toBe(0);
    expect(uav.t).toBe(0);
  });

  it('never lowers an existing spot', () => {
    const uav = createUav();
    const e = makeEnemy('heavy', 0, 0);
    e.spot = 0.9;
    stepUav(uav, [e], 0.1);
    expect(e.spot).toBe(0.9);
  });
});
