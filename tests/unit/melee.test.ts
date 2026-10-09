import { describe, it, expect } from 'vitest';
import { KILL_SCORE } from '../../src/sim/combat';
import { makeEnemy, openFieldSim, pressing, IDLE, DT } from './support/sim-fixtures';
import {
  MELEE_COOLDOWN,
  MELEE_DMG_BEHIND,
  MELEE_DMG_FRONT,
  MELEE_RANGE,
  MELEE_TIME,
  meleeStrike,
} from '../../src/sim/melee';
import type { SimEvent } from '../../src/sim/world';

// Melee knife (spec §1.3 WPN-08; legacy index.html:3243-3257). The player stands at the origin facing +z (yaw 0), so
// the view direction is (0, 1). An enemy with yaw 0 faces +z too, which puts the player behind it.

const AT_ORIGIN = { x: 0, z: 0 };
const FORWARD_YAW = 0;

describe('meleeStrike (pure)', () => {
  it('hits a hostile in front for the front damage', () => {
    const e = makeEnemy('rifle', 0, 1);
    e.yaw = Math.PI; // faces the player
    const hits = meleeStrike(AT_ORIGIN, FORWARD_YAW, [e]);
    expect(hits).toEqual([{ enemy: e, behind: false, damage: MELEE_DMG_FRONT }]);
  });

  it('hits a hostile from behind for the back-stab damage', () => {
    const e = makeEnemy('rifle', 0, 1);
    e.yaw = 0; // faces away, the same way as the player
    const hits = meleeStrike(AT_ORIGIN, FORWARD_YAW, [e]);
    expect(hits).toEqual([{ enemy: e, behind: true, damage: MELEE_DMG_BEHIND }]);
  });

  it('treats a hostile turned well to one side as from the front', () => {
    const e = makeEnemy('rifle', 0, 1);
    e.yaw = Math.PI / 2; // facing sideways: the dot with the view is 0, below the back threshold
    expect(meleeStrike(AT_ORIGIN, FORWARD_YAW, [e])[0]?.behind).toBe(false);
  });

  it('reaches the range limit but not past it', () => {
    const near = makeEnemy('rifle', 0, MELEE_RANGE - 0.01);
    const far = makeEnemy('rifle', 0, MELEE_RANGE + 0.01);
    const hits = meleeStrike(AT_ORIGIN, FORWARD_YAW, [near, far]);
    expect(hits.map((h) => h.enemy)).toEqual([near]);
  });

  it('ignores hostiles outside the cone', () => {
    // 90 degrees to the side: the dot with the view is 0, below the 0.55 cone threshold.
    const side = makeEnemy('rifle', 1, 0);
    expect(meleeStrike(AT_ORIGIN, FORWARD_YAW, [side])).toEqual([]);
  });

  it('ignores hostiles behind the player', () => {
    const back = makeEnemy('rifle', 0, -1);
    expect(meleeStrike(AT_ORIGIN, FORWARD_YAW, [back])).toEqual([]);
  });

  it('ignores dead hostiles', () => {
    const dead = makeEnemy('rifle', 0, 1);
    dead.alive = false;
    expect(meleeStrike(AT_ORIGIN, FORWARD_YAW, [dead])).toEqual([]);
  });

  it('follows the view yaw', () => {
    // Yaw π/2 looks along +x, so a hostile at (1, 0) is in front.
    const e = makeEnemy('rifle', 1, 0);
    e.yaw = Math.PI * 1.5;
    expect(meleeStrike(AT_ORIGIN, Math.PI / 2, [e])).toHaveLength(1);
  });

  it('keeps the legacy numbers', () => {
    expect(MELEE_RANGE).toBe(1.7);
    expect(MELEE_COOLDOWN).toBe(0.9);
    expect(MELEE_TIME).toBe(0.3);
    expect(MELEE_DMG_BEHIND).toBe(150);
    expect(MELEE_DMG_FRONT).toBe(80);
  });
});

describe('SimWorld melee', () => {
  // A hostile 1 m in front of the player. Its yaw decides front or behind.
  function frontSim(yaw: number, kind: 'rifle' | 'heavy' = 'rifle') {
    const sim = openFieldSim({ playerSpawn: { x: 0, y: 0, z: 0 }, playerYaw: FORWARD_YAW });
    const e = makeEnemy(kind, 0, 1);
    e.yaw = yaw;
    sim.operators = []; // squad fire would hit the hostile too
    sim.enemies = [e];
    return { sim, e };
  }

  function meleeEvents(events: SimEvent[]): SimEvent[] {
    return events.filter((ev) => ev.type === 'melee' || ev.type === 'enemyHit' || ev.type === 'enemyKilled');
  }

  it('swings on the melee key and reports the hits', () => {
    const { sim, e } = frontSim(Math.PI);
    const events = sim.step(pressing('melee'), DT);
    expect(events).toContainEqual({ type: 'melee', hits: 1 });
    expect(e.hp).toBe(e.maxHp - MELEE_DMG_FRONT);
    expect(meleeEvents(events).some((ev) => ev.type === 'enemyHit')).toBe(true);
  });

  it('does the back-stab damage when the hostile faces away', () => {
    const { sim, e } = frontSim(0);
    sim.step(pressing('melee'), DT);
    expect(e.hp).toBe(e.maxHp - MELEE_DMG_BEHIND);
  });

  it('applies the heavy shield multiplier to a body hit from behind', () => {
    const { sim, e } = frontSim(0, 'heavy');
    sim.step(pressing('melee'), DT);
    // Heavies take 60% of non-head damage (combat.ts HEAVY_BODY_MULT).
    expect(e.hp).toBeCloseTo(e.maxHp - MELEE_DMG_BEHIND * 0.6, 6);
  });

  it('kills with the knife and scores like a bullet kill', () => {
    const { sim, e } = frontSim(Math.PI); // 80 damage: a rifle has 60 hp
    const events = sim.step(pressing('melee'), DT);
    expect(e.alive).toBe(false);
    expect(events.some((ev) => ev.type === 'enemyKilled' && ev.by === 'player')).toBe(true);
    expect(sim.playerKills).toBe(1);
    expect(sim.score).toBe(KILL_SCORE);
  });

  it('misses still swing: event with zero hits and the cooldown starts', () => {
    const sim = openFieldSim({ playerSpawn: { x: 0, y: 0, z: 0 }, playerYaw: FORWARD_YAW });
    sim.operators = [];
    sim.enemies = [];
    const events = sim.step(pressing('melee'), DT);
    expect(events).toContainEqual({ type: 'melee', hits: 0 });
    expect(sim.meleeCd).toBeGreaterThan(0);
  });

  it('holds the swing animation for MELEE_TIME, then clears it', () => {
    const sim = openFieldSim({ playerSpawn: { x: 0, y: 0, z: 0 }, playerYaw: FORWARD_YAW });
    sim.enemies = [];
    sim.step(pressing('melee'), DT);
    // The countdown starts on the next tick, so the swing tick leaves the full time.
    expect(sim.meleeT).toBe(MELEE_TIME);
    for (let i = 0; i < Math.ceil(MELEE_TIME / DT) + 1; i++) sim.step(IDLE, DT);
    expect(sim.meleeT).toBe(0);
  });

  it('ignores a second press during the cooldown and accepts one after it', () => {
    const { sim } = frontSim(Math.PI);
    sim.enemies = [];
    const first = sim.step(pressing('melee'), DT);
    expect(first.filter((ev) => ev.type === 'melee')).toHaveLength(1);

    const during = sim.step(pressing('melee'), DT);
    expect(during.filter((ev) => ev.type === 'melee')).toHaveLength(0);

    for (let i = 0; i < Math.ceil(MELEE_COOLDOWN / DT) + 2; i++) sim.step(IDLE, DT);
    const after = sim.step(pressing('melee'), DT);
    expect(after.filter((ev) => ev.type === 'melee')).toHaveLength(1);
  });

  it('does nothing while dead', () => {
    const { sim, e } = frontSim(Math.PI);
    sim.player.alive = false;
    const events = sim.step(pressing('melee'), DT);
    expect(events.some((ev) => ev.type === 'melee')).toBe(false);
    expect(e.hp).toBe(e.maxHp);
  });

  it('resets the knife timers on a new match', () => {
    const sim = openFieldSim({ playerSpawn: { x: 0, y: 0, z: 0 }, playerYaw: FORWARD_YAW });
    sim.enemies = [];
    sim.step(pressing('melee'), DT);
    expect(sim.meleeCd).toBeGreaterThan(0);
    sim.restart();
    expect(sim.meleeCd).toBe(0);
    expect(sim.meleeT).toBe(0);
  });
});
