import { describe, it, expect } from 'vitest';
import type { Action } from '../../src/content/ids';
import { DIFF } from '../../src/content/difficulty';
import { ENEMY_DEFS, type EnemyKindId } from '../../src/content/enemies';
import { WEAPONS } from '../../src/content/weapons';
import { createRng } from '../../src/core/rng';
import { CollisionWorld } from '../../src/sim/collision';
import type { Enemy } from '../../src/sim/entities';
import type { Command } from '../../src/input/commands';
import { SimWorld, type SimEvent } from '../../src/sim/world';

// Combat wiring in SimWorld on an open field: player shots, hostile shots on the player, operator kills.

const DT = 1 / 60;

const IDLE: Command = {
  move: { fwd: 0, strafe: 0 },
  look: { dx: 0, dy: 0 },
  buttons: { fire: false, ads: false },
  pressed: new Set<Action>(),
  crouch: false,
  sprint: false,
};

function makeSim(seed = 1): SimWorld {
  return new SimWorld({
    collision: new CollisionWorld(),
    zones: [],
    spawns: [{ x: 0, z: 40 }],
    buildings: [],
    rng: createRng(seed),
    difficulty: DIFF.veteran,
    weapon: WEAPONS.vx,
    attachment: 'reflex',
    perk: 'steady',
    adsRate: 17,
    playerSpawn: { x: 0, y: 0, z: 0 },
    playerYaw: 0,
  });
}

function makeEnemy(kind: EnemyKindId, x: number, z: number): Enemy {
  const def = ENEMY_DEFS[kind];
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
    hp: def.hp,
    maxHp: def.hp,
    pos: { x, z },
    yaw: 0,
    state: 'hunt',
    home: null,
    lastSeen: null,
    sight: def.sight,
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
    strafeT: 1,
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

function kinds(events: SimEvent[]): Set<string> {
  return new Set(events.map((ev) => ev.type));
}

describe('SimWorld combat wiring', () => {
  it('a player shot at a hostile 10 m ahead damages it and counts a hit', () => {
    const sim = makeSim();
    const e = makeEnemy('rifle', 0, 10);
    sim.enemies.push(e);
    const events = sim.step(IDLE, DT, true);
    expect(kinds(events).has('playerFire')).toBe(true);
    expect(events.some((ev) => ev.type === 'bullet' && ev.enemy === e)).toBe(true);
    expect(e.hp).toBeLessThan(e.maxHp);
    expect(sim.playerHits).toBe(1);
    expect(sim.playerShots).toBe(1);
  });

  it('a hostile that sees the player hurts the player and the player takes damage', () => {
    const sim = makeSim();
    // Take the squad out of the fight, so the hostile's only target is the player.
    for (const a of sim.operators) {
      a.alive = false;
      a.deathT = 1e9;
    }
    sim.enemies.push(makeEnemy('heavy', 0, 12));
    let minHp = sim.player.hp;
    for (let i = 0; i < 20 * 60; i++) {
      const events = sim.step(IDLE, DT);
      if (events.some((ev) => ev.type === 'playerHit')) minHp = Math.min(minHp, sim.player.hp);
      if (sim.outcome !== 'playing') break;
    }
    expect(minHp).toBeLessThan(100);
  });

  it('an operator kill is credited to the operator and costs an enemy ticket', () => {
    const sim = makeSim();
    const e = makeEnemy('rifle', 0, 12);
    e.hp = 1;
    sim.enemies.push(e);
    const ticketsBefore = sim.enemyTickets;
    let credited = false;
    for (let i = 0; i < 20 * 60 && !credited; i++) {
      for (const ev of sim.step(IDLE, DT)) {
        if (ev.type === 'enemyKilled' && ev.by === 'operator') credited = true;
      }
    }
    expect(credited).toBe(true);
    expect(sim.operators.reduce((n, a) => n + a.kills, 0)).toBe(1);
    expect(sim.enemyTickets).toBe(ticketsBefore - 1);
    expect(sim.playerKills).toBe(0);
  });
});
