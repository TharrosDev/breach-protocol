import { describe, it, expect } from 'vitest';
import { ENEMY_DEFS } from '../../src/content/enemies';
import type { SimEvent } from '../../src/sim/world';
import { mapSimEventToSound } from '../../src/app/sound-map';
import { DT, IDLE, makeEnemy, openFieldSim, pressing } from './support/sim-fixtures';
import type { Command } from '../../src/input/commands';

// The events the profile and the audio read: where a kill came from, and the medic's heal cue.

function kills(events: SimEvent[]): { source: string; by: string }[] {
  const out: { source: string; by: string }[] = [];
  for (const ev of events) if (ev.type === 'enemyKilled') out.push({ source: ev.source, by: ev.by });
  return out;
}

function runFor(sim: ReturnType<typeof openFieldSim>, seconds: number, cmd: Command = IDLE): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...sim.step(cmd, DT));
  return out;
}

describe('kill source', () => {
  it('a bullet kill carries the weapon id', () => {
    const sim = openFieldSim();
    const e = makeEnemy('rifle', 0, 6);
    e.hp = 1;
    sim.enemies = [e];
    // The squad would shoot a one-hp hostile first.
    sim.operators = [];
    const events = sim.step({ ...IDLE, buttons: { fire: true, ads: false } }, DT, true);
    expect(kills(events)).toEqual([{ source: 'vx', by: 'player' }]);
  });

  it('a knife kill is melee', () => {
    const sim = openFieldSim();
    const e = makeEnemy('rifle', 0, 1);
    e.hp = 1;
    sim.enemies = [e];
    // The squad would shoot a one-hp hostile first.
    sim.operators = [];
    const events = sim.step(pressing('melee'), DT);
    expect(kills(events)).toEqual([{ source: 'melee', by: 'player' }]);
  });

  it('a frag kill is frag', () => {
    const sim = openFieldSim();
    sim.step(pressing('gadget1'), DT);
    const grenade = sim.grenades[0];
    expect(grenade).toBeDefined();
    if (grenade === undefined) return;
    const e = makeEnemy('rifle', grenade.pos.x, grenade.pos.z + 12);
    e.hp = 1;
    sim.enemies = [e];
    // The squad would shoot a one-hp hostile first.
    sim.operators = [];
    const events: SimEvent[] = [];
    let blasted = false;
    for (let i = 0; i < 240 && !blasted; i++) {
      // Keep the hostile where the grenade will land by moving it each tick.
      const g = sim.grenades[0];
      if (g !== undefined) {
        e.pos.x = g.pos.x;
        e.pos.z = g.pos.z;
      }
      const stepEvents = sim.step(IDLE, DT);
      blasted = stepEvents.some((ev) => ev.type === 'grenadeBlast');
      events.push(...stepEvents);
    }
    expect(kills(events).some((k) => k.source === 'frag')).toBe(true);
  });

  it('a claymore kill is mine', () => {
    const sim = openFieldSim({ gadgets: ['claymore', 'smoke'] });
    sim.step(pressing('gadget1'), DT);
    const mine = sim.mines[0];
    expect(mine).toBeDefined();
    if (mine === undefined) return;
    expect(mine.yaw).toBeCloseTo(0, 5);
    const e = makeEnemy('rifle', mine.pos.x, mine.pos.z + 2);
    e.hp = 1;
    sim.enemies = [e];
    // The squad would shoot a one-hp hostile first.
    sim.operators = [];
    // Hold the hostile next to the mine (it would back away), until the mine arms and blows.
    const events: SimEvent[] = [];
    for (let i = 0; i < 120; i++) {
      e.pos.x = mine.pos.x;
      e.pos.z = mine.pos.z + 2;
      events.push(...sim.step(IDLE, DT));
    }
    expect(kills(events).some((k) => k.source === 'mine')).toBe(true);
  });
});

describe('medic heal cue', () => {
  it('fires while a medic mends an ally, and not every tick', () => {
    const sim = openFieldSim();
    const medic = makeEnemy('medic', 0, 60);
    const ally = makeEnemy('rifle', 3, 60);
    ally.hp = 10;
    sim.enemies = [medic, ally];
    const events = runFor(sim, 4);
    const pings = events.filter((ev) => ev.type === 'medicHeal');
    expect(pings.length).toBeGreaterThanOrEqual(2);
    expect(pings.length).toBeLessThanOrEqual(4);
    expect(ally.hp).toBeGreaterThan(10);
  });

  it('stays quiet when nobody needs mending', () => {
    const sim = openFieldSim();
    sim.enemies = [makeEnemy('medic', 0, 60), makeEnemy('rifle', 3, 60)];
    expect(runFor(sim, 3).some((ev) => ev.type === 'medicHeal')).toBe(false);
  });

  it('a blinded medic does not mend', () => {
    const sim = openFieldSim();
    const medic = makeEnemy('medic', 0, 60);
    medic.blind = 100;
    const ally = makeEnemy('rifle', 3, 60);
    ally.hp = 10;
    sim.enemies = [medic, ally];
    expect(runFor(sim, 2).some((ev) => ev.type === 'medicHeal')).toBe(false);
    expect(ENEMY_DEFS.medic.medic).toBe(true);
  });
});

describe('gadget and killstreak sounds', () => {
  it('medic heal, claymore set, Aegis shield and EMP pulse have sounds', () => {
    expect(mapSimEventToSound({ type: 'medicHeal', at: { x: 0, z: 0 } })).toEqual({ type: 'medicHeal' });
    expect(mapSimEventToSound({ type: 'mineSet', at: { x: 0, y: 0, z: 0 } })).toEqual({ type: 'mineSet' });
    expect(mapSimEventToSound({ type: 'killstreakUsed', id: 'shield' })).toEqual({ type: 'shield' });
    expect(mapSimEventToSound({ type: 'killstreakUsed', id: 'emp' })).toEqual({ type: 'emp' });
  });

  it('the other killstreaks stay silent on use', () => {
    for (const id of ['uav', 'sentry', 'airstrike'] as const) {
      expect(mapSimEventToSound({ type: 'killstreakUsed', id })).toBeNull();
    }
  });
});
