import { describe, it, expect } from 'vitest';
import { ZONE_TICKET_COST } from '../../src/content/tuning';
import { makeGrenade } from '../../src/sim/grenades';
import { ZONE_CAPTURE_SCORE } from '../../src/sim/objectives';
import type { SimEvent, SimWorld } from '../../src/sim/world';
import { DT, IDLE, compoundSim, makeEnemy, openFieldSim, pressing } from './support/sim-fixtures';
import type { Command } from '../../src/input/commands';

// Phase 4 gate: zone capture, the match outcomes, and the killstreak rules, run through SimWorld.

// Runs the sim for `seconds` of fixed ticks and returns every event it produced.
function run(sim: SimWorld, seconds: number, cmd: Command = IDLE): SimEvent[] {
  const out: SimEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) out.push(...sim.step(cmd, DT));
  return out;
}

function kinds(events: SimEvent[]): string[] {
  return events.map((ev) => ev.type);
}

describe('zone capture on Compound', () => {
  it('a friendly operator inside a zone captures it in 7 s, and the player earns no bonus outside it', () => {
    const { sim } = compoundSim();
    const zone = sim.zones[0];
    const a = sim.operators[0];
    if (zone === undefined || a === undefined) throw new RangeError('Compound has zones and squad');
    a.pos = { x: zone.x, z: zone.z };
    sim.order = 1; // HOLD, so the operator stays in the zone
    const ticketsBefore = sim.enemyTickets;

    const events = run(sim, 7.2);

    expect(zone.captured).toBe(true);
    expect(sim.score).toBe(0);
    expect(sim.enemyTickets).toBe(ticketsBefore - ZONE_TICKET_COST);
    expect(events).toContainEqual(expect.objectContaining({ type: 'zoneCaptured', playerBonus: false }));
  });

  it('a zone is not captured before 7 s of friendly presence', () => {
    const { sim } = compoundSim();
    const zone = sim.zones[0];
    const a = sim.operators[0];
    if (zone === undefined || a === undefined) throw new RangeError('Compound has zones and squad');
    a.pos = { x: zone.x, z: zone.z };
    sim.order = 1;

    run(sim, 6.5);

    expect(zone.captured).toBe(false);
    expect(zone.prog).toBeGreaterThan(0.8);
  });

  it('a player inside the zone at capture earns the +250 bonus', () => {
    const { sim } = compoundSim();
    const zone = sim.zones[0];
    if (zone === undefined) throw new RangeError('Compound has zones');
    sim.player.pos = { x: zone.x, y: 0, z: zone.z };

    const events = run(sim, 7.2);

    expect(zone.captured).toBe(true);
    expect(sim.score).toBe(ZONE_CAPTURE_SCORE);
    expect(events).toContainEqual(expect.objectContaining({ type: 'zoneCaptured', playerBonus: true }));
  });

  it('a hostile inside a zone stops the capture', () => {
    const { sim } = compoundSim();
    const zone = sim.zones[0];
    const a = sim.operators[0];
    if (zone === undefined || a === undefined) throw new RangeError('Compound has zones and squad');
    a.pos = { x: zone.x, z: zone.z };
    sim.order = 1;
    const hostile = makeEnemy('rifle', zone.x + 1, zone.z);
    // A guard that holds its post inside the zone, and too tough for the squad to kill during the test.
    hostile.state = 'guard';
    hostile.home = { x: zone.x + 1, z: zone.z };
    hostile.hp = 1e6;
    hostile.maxHp = 1e6;
    sim.enemies.push(hostile);

    // Only the first ticks: once the hostile notices the squad it hunts out of the zone, and capture resumes.
    run(sim, 0.1);

    expect(zone.captured).toBe(false);
    expect(zone.prog).toBe(0);
    expect(zone.status).toBe('contested');
  });
});

describe('match outcome', () => {
  it('win: enemy tickets reach 0, the match ends once and then stops', () => {
    const sim = openFieldSim();
    sim.forceEnemyTickets(0);

    const first = sim.step(IDLE, DT);

    expect(sim.outcome).toBe('won');
    expect(sim.result?.win).toBe(true);
    expect(kinds(first)).toContain('matchEnd');
    expect(sim.step(IDLE, DT)).toEqual([]);
    expect(sim.result?.win).toBe(true);
  });

  it('the result carries the debrief fields: shots, hits, streak and the objectives', () => {
    const sim = openFieldSim();
    sim.playerShots = 12;
    sim.playerHits = 5;
    sim.streak = 3;
    sim.forceEnemyTickets(0);

    sim.step(IDLE, DT);

    expect(sim.result).toMatchObject({
      win: true,
      shots: 12,
      hits: 5,
      streak: 3,
      zones: [{ name: 'Far', captured: false }],
    });
  });

  it('win: every zone captured', () => {
    const { sim } = compoundSim();
    for (const z of sim.zones) z.captured = true;

    sim.step(IDLE, DT);

    expect(sim.outcome).toBe('won');
  });

  it('loss: the player is killed with no reinforcements left', () => {
    const sim = openFieldSim();
    sim.lives = 0;
    for (const a of sim.operators) {
      a.alive = false;
      a.deathT = 1e9;
    }
    sim.player.hp = 10;
    // An enemy frag at the player's feet: 80 damage at the centre, far more than 10 hp.
    sim.grenades.push(makeGrenade('enemy', 'frag', { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0 }, 0.01));

    const events = sim.step(IDLE, DT);

    expect(kinds(events)).toContain('playerEliminated');
    expect(sim.player.alive).toBe(false);
    expect(sim.outcome).toBe('lost');
    expect(sim.result?.win).toBe(false);
    expect(sim.deaths).toBe(1);
  });

  it('no loss with a reinforcement left: the player respawns after 4 s', () => {
    const sim = openFieldSim();
    sim.lives = 1;
    for (const a of sim.operators) {
      a.alive = false;
      a.deathT = 1e9;
    }
    sim.player.hp = 10;
    sim.grenades.push(makeGrenade('enemy', 'frag', { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0 }, 0.01));

    sim.step(IDLE, DT);
    expect(sim.player.alive).toBe(false);
    expect(sim.lives).toBe(0);
    expect(sim.outcome).toBe('playing');

    run(sim, 4.2);

    expect(sim.player.alive).toBe(true);
    expect(sim.outcome).toBe('playing');
  });
});

describe('killstreaks and kills', () => {
  it('a kill that reaches 3 in a row awards the UAV, and the kill scores 100', () => {
    const sim = openFieldSim();
    const e = makeEnemy('rifle', 0, 10);
    e.hp = 1;
    sim.enemies.push(e);
    sim.streak = 2;
    const ticketsBefore = sim.enemyTickets;

    const events = sim.step(IDLE, DT, true);

    expect(e.alive).toBe(false);
    expect(sim.playerKills).toBe(1);
    expect(sim.streak).toBe(3);
    expect(sim.killstreak.ks).toBe('uav');
    expect(sim.score).toBeGreaterThanOrEqual(100);
    expect(sim.enemyTickets).toBe(ticketsBefore - 1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'killstreakEarned', id: 'uav' }));
  });

  it('the UAV reveals hostiles: a spot is held up while it is up, then ends after 20 s', () => {
    const sim = openFieldSim();
    sim.killstreak = { ks: 'uav', ksUsed: 0 };
    const e = makeEnemy('rifle', 0, 20);
    sim.enemies.push(e);

    const first = sim.step(pressing('killstreak'), DT);

    expect(first).toContainEqual(expect.objectContaining({ type: 'killstreakUsed', id: 'uav' }));
    expect(sim.killstreak).toEqual({ ks: null, ksUsed: 1 });
    expect(sim.spotted).toContain(e);

    run(sim, 21);
    expect(sim.uav.t).toBe(0);
  });

  it('an airstrike lands five blasts over about 1.6 s, then ends', () => {
    const sim = openFieldSim();
    sim.killstreak = { ks: 'airstrike', ksUsed: 0 };

    sim.step(pressing('killstreak'), DT);
    expect(sim.airstrikes).toHaveLength(1);

    const events = run(sim, 1.8);

    expect(events.filter((ev) => ev.type === 'airstrikeBlast')).toHaveLength(5);
    expect(sim.airstrikes).toHaveLength(0);
  });

  it('a sentry on open ground is placed and expires after 45 s', () => {
    const sim = openFieldSim();
    sim.killstreak = { ks: 'sentry', ksUsed: 0 };

    sim.step(pressing('killstreak'), DT);
    expect(sim.turrets).toHaveLength(1);
    expect(sim.killstreak.ks).toBeNull();

    run(sim, 46);
    expect(sim.turrets).toHaveLength(0);
  });

  it('a sentry with no clear ground keeps its killstreak', () => {
    const sim = openFieldSim();
    // A box where the level aim lands 8 m ahead, so no placement distance is clear.
    sim.collision.add({ min: { x: -1, y: 0, z: 7 }, max: { x: 1, y: 2, z: 9 } });
    sim.killstreak = { ks: 'sentry', ksUsed: 0 };

    const events = sim.step(pressing('killstreak'), DT);

    expect(events).toContainEqual(expect.objectContaining({ type: 'sentryNoGround' }));
    expect(sim.turrets).toHaveLength(0);
    expect(sim.killstreak).toEqual({ ks: 'sentry', ksUsed: 0 });
  });

  it('a down keeps the streak and the held killstreak (legacy killPlayer)', () => {
    const sim = openFieldSim();
    sim.lives = 2;
    sim.streak = 4;
    sim.killstreak = { ks: 'uav', ksUsed: 1 };
    sim.player.hp = 10;
    // The squad is alive and near, so the player is downed, not eliminated.
    sim.grenades.push(makeGrenade('enemy', 'frag', { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0 }, 0.01));

    sim.step(IDLE, DT);

    expect(sim.player.downed).toBe(true);
    expect(sim.deaths).toBe(0);
    expect(sim.streak).toBe(4);
    expect(sim.killstreak).toEqual({ ks: 'uav', ksUsed: 1 });
  });

  it('an elimination clears the streak and the held killstreak', () => {
    const sim = openFieldSim();
    sim.lives = 2;
    sim.streak = 4;
    sim.killstreak = { ks: 'uav', ksUsed: 1 };
    sim.player.hp = 10;
    for (const a of sim.operators) {
      a.alive = false;
      a.deathT = 1e9;
    }
    sim.grenades.push(makeGrenade('enemy', 'frag', { x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0 }, 0.01));

    sim.step(IDLE, DT);

    expect(sim.deaths).toBe(1);
    expect(sim.lives).toBe(1);
    expect(sim.streak).toBe(0);
    expect(sim.killstreak).toEqual({ ks: null, ksUsed: 1 });
  });
});
