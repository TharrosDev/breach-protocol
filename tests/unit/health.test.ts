import { describe, it, expect } from 'vitest';
import type { Enemy, Operator } from '../../src/sim/entities';
import {
  damagePlayer,
  damageOperator,
  hasNearbyOperator,
  killPlayerOrDown,
  passiveRegen,
  respawnSpot,
  revivePlayer,
} from '../../src/sim/health';

function makeOperator(x: number, z: number, alive = true): Operator {
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
    name: 'Test',
    ox: 0,
    oz: 0,
    alive,
    hp: 100,
    maxHp: 100,
    pos: { x, z },
    yaw: 0,
    fireT: 0,
    deathT: 0,
    kills: 0,
    reviveT: 0,
    moving: false,
    phase: 0,
  };
}

function makeEnemy(x: number, z: number): Enemy {
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
    kind: 'rifle',
    alive: true,
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

const openAll = (): boolean => true;

describe('damagePlayer', () => {
  it('reports a kill when hp reaches 0', () => {
    const p = { hp: 10, alive: true, lastHurt: 0 };
    expect(damagePlayer(p, 10, 3)).toEqual({ killed: true });
    expect(p.hp).toBe(0);
    expect(p.lastHurt).toBe(3);
  });

  it('reduces hp and records the hit time without a kill', () => {
    const p = { hp: 100, alive: true, lastHurt: 0 };
    expect(damagePlayer(p, 30, 5)).toEqual({ killed: false });
    expect(p.hp).toBe(70);
    expect(p.lastHurt).toBe(5);
  });

  it('ignores damage to a dead player', () => {
    const p = { hp: 0, alive: false, lastHurt: 0 };
    expect(damagePlayer(p, 30, 5)).toEqual({ killed: false });
    expect(p.lastHurt).toBe(0);
  });
});

describe('killPlayerOrDown', () => {
  it('returns down with a living operator within 18 m and starts a 12 s bleedout', () => {
    const p = { hp: 0, alive: true, downed: false, bleedT: 0 };
    const near = [makeOperator(17, 0)];
    expect(killPlayerOrDown(p, hasNearbyOperator({ x: 0, z: 0 }, near))).toBe('down');
    expect(p.downed).toBe(true);
    expect(p.bleedT).toBe(12);
    expect(p.alive).toBe(false);
  });

  it('returns dead when the only operator is 19 m away', () => {
    const p = { hp: 0, alive: true, downed: false, bleedT: 0 };
    const far = [makeOperator(19, 0)];
    expect(killPlayerOrDown(p, hasNearbyOperator({ x: 0, z: 0 }, far))).toBe('dead');
    expect(p.downed).toBe(false);
  });

  it('returns dead when the nearby operator is down', () => {
    const p = { hp: 0, alive: true, downed: false, bleedT: 0 };
    const down = [makeOperator(3, 0, false)];
    expect(hasNearbyOperator({ x: 0, z: 0 }, down)).toBe(false);
    expect(killPlayerOrDown(p, false)).toBe('dead');
  });
});

describe('revivePlayer', () => {
  it('restores 40 hp and awards 150 score', () => {
    const p = { hp: 0, alive: false, downed: true };
    expect(revivePlayer(p)).toEqual({ scoreDelta: 150 });
    expect(p.hp).toBe(40);
    expect(p.alive).toBe(true);
    expect(p.downed).toBe(false);
  });
});

describe('respawnSpot', () => {
  it('prefers the offset beside the first clear living operator', () => {
    const ops = [makeOperator(0, 0), makeOperator(100, 100)];
    expect(respawnSpot(ops, [], [{ x: -50, z: 0 }], openAll)).toEqual({ x: 2.5, z: -2.5 });
  });

  it('skips dead operators', () => {
    const ops = [makeOperator(0, 0, false), makeOperator(10, 10)];
    expect(respawnSpot(ops, [], [{ x: -50, z: 0 }], openAll)).toEqual({ x: 12.5, z: 7.5 });
  });

  it('falls back to the spawn furthest from its nearest living enemy when the operator spot is covered', () => {
    const ops = [makeOperator(0, 0)];
    const enemies = [makeEnemy(0, 0)];
    const spawns = [
      { x: -10, z: 0 },
      { x: 20, z: 0 },
    ];
    expect(respawnSpot(ops, enemies, spawns, openAll)).toEqual({ x: 20, z: 0 });
  });

  it('ignores enemies that are dead when checking the operator spot', () => {
    const ops = [makeOperator(0, 0)];
    const dead = makeEnemy(0, 0);
    dead.alive = false;
    expect(respawnSpot(ops, [dead], [{ x: -50, z: 0 }], openAll)).toEqual({ x: 2.5, z: -2.5 });
  });
});

describe('damageOperator', () => {
  it('kills an operator at 0 hp and starts the 20 s respawn timer', () => {
    const a = makeOperator(0, 0);
    expect(damageOperator(a, 100)).toEqual({ killed: true });
    expect(a.alive).toBe(false);
    expect(a.deathT).toBe(20);
  });

  it('leaves a wounded operator alive', () => {
    const a = makeOperator(0, 0);
    expect(damageOperator(a, 40)).toEqual({ killed: false });
    expect(a.alive).toBe(true);
    expect(a.hp).toBe(60);
  });
});

describe('passiveRegen', () => {
  it('does not regenerate until more than 4 s have passed since the last hit', () => {
    expect(passiveRegen(50, 1, 4, 0)).toBe(50);
  });

  it('adds 25 hp per second after 4 s', () => {
    expect(passiveRegen(50, 1, 5, 0)).toBe(75);
  });

  it('caps at 100 hp', () => {
    expect(passiveRegen(99, 1, 10, 0)).toBe(100);
  });
});
