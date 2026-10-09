import { describe, it, expect } from 'vitest';
import {
  FEED_KEEP,
  HudState,
  KILLSTREAK_USED,
  MULTI_KILL_WINDOW,
  SQUAD_ORDER_NAMES,
  buildHudExtras,
  buildHudView,
  introKeys,
  nextStreakAt,
  promptFor,
  type HudEnv,
} from '../../src/app/hud-view';
import { DIFF } from '../../src/content/difficulty';
import { ANNOUNCE_SECONDS } from '../../src/ui/hud/layout';
import { openFieldSim } from './support/sim-fixtures';

// Keys as the labels a player sees. Every action maps to its own letter, so a wrong binding shows up in the text.
const env: HudEnv = {
  difficultyTickets: DIFF.veteran.tickets,
  keyOf: (action) => action.toUpperCase(),
};

describe('HudState feed', () => {
  it('puts the newest line first and keeps only the last FEED_KEEP lines', () => {
    const state = new HudState();
    for (let i = 0; i < FEED_KEEP + 3; i++) state.feed(`line ${String(i)}`);
    const lines = state.feedLines();
    expect(lines).toHaveLength(FEED_KEEP);
    expect(lines[0]?.text).toBe(`line ${String(FEED_KEEP + 2)}`);
    expect(lines[FEED_KEEP - 1]?.text).toBe('line 3');
  });

  it('keeps the class of each line', () => {
    const state = new HudState();
    state.feed('Resupplied', 'good');
    state.feed('You were eliminated', 'death');
    expect(state.feedLines()).toEqual([
      { text: 'You were eliminated', cls: 'death' },
      { text: 'Resupplied', cls: 'good' },
    ]);
  });
});

describe('HudState banners', () => {
  it('shows an announcement for its time, then clears it', () => {
    const state = new HudState();
    state.announce('Squad: HOLD', '', 1.2);
    expect(state.bannerNow()).toEqual({ text: 'Squad: HOLD', sub: '' });
    state.advance(1.1);
    expect(state.bannerNow()).not.toBeNull();
    state.advance(0.2);
    expect(state.bannerNow()).toBeNull();
  });

  it('uses the default time for a banner that gives none', () => {
    const state = new HudState();
    state.announce('Triple kill');
    state.advance(ANNOUNCE_SECONDS - 0.01);
    expect(state.bannerNow()).not.toBeNull();
    state.advance(0.02);
    expect(state.bannerNow()).toBeNull();
  });

  it('a newer announcement replaces the older one', () => {
    const state = new HudState();
    state.announce('Double kill');
    state.announce('Rampage');
    expect(state.bannerNow()?.text).toBe('Rampage');
  });

  it('ignores a time step that is not a positive number', () => {
    const state = new HudState();
    state.announce('UAV ONLINE', 'all hostiles revealed', 1);
    state.advance(Number.NaN);
    state.advance(-5);
    state.advance(0.5);
    expect(state.bannerNow()).not.toBeNull();
  });
});

describe('HudState kills', () => {
  it('feeds the kill and announces the second, third and later kills in the window', () => {
    const state = new HudState();
    state.playerKill('Rifleman', false);
    expect(state.bannerNow()).toBeNull();
    expect(state.feedLines()[0]).toEqual({ text: 'You -> Rifleman', cls: 'kill' });

    state.playerKill('Heavy', true);
    expect(state.bannerNow()?.text).toBe('Double kill');
    expect(state.feedLines()[0]?.text).toBe('You -> Heavy [HEADSHOT]');

    state.playerKill('Sniper', false);
    expect(state.bannerNow()?.text).toBe('Triple kill');
    state.playerKill('Grenadier', false);
    expect(state.bannerNow()?.text).toBe('Rampage');
  });

  it('starts the count again after the kill window', () => {
    const state = new HudState();
    state.playerKill('Rifleman', false);
    state.advance(MULTI_KILL_WINDOW + 0.5);
    state.playerKill('Rifleman', false);
    expect(state.bannerNow()).toBeNull();
  });
});

describe('HudState hit marker', () => {
  it('reports the strongest hit of the frame, then clears', () => {
    const state = new HudState();
    state.hit('hit');
    state.hit('kill');
    state.hit('hit');
    expect(state.takeHit()).toBe('kill');
    expect(state.takeHit()).toBe('none');
  });

  it('a head shot beats a kill in the same frame', () => {
    const state = new HudState();
    state.hit('kill');
    state.hit('head');
    expect(state.takeHit()).toBe('head');
  });
});

describe('nextStreakAt', () => {
  it('gives the next reward (3, 5, then 7), and null after the last', () => {
    expect(nextStreakAt(0)).toBe(3);
    expect(nextStreakAt(2)).toBe(3);
    expect(nextStreakAt(3)).toBe(5);
    expect(nextStreakAt(5)).toBe(7);
    expect(nextStreakAt(7)).toBeNull();
    expect(nextStreakAt(9)).toBeNull();
  });
});

describe('buildHudView', () => {
  it('reads the sim: health, weapon, squad, zones and the labelled tickets', () => {
    const sim = openFieldSim();
    const view = buildHudView(sim, env, new HudState());
    expect(view.hp).toBe(100);
    expect(view.alive).toBe(true);
    expect(view.weaponName).toBe('VX-9 Rifle');
    expect(view.ammo).toBe(sim.weapon.ammo);
    expect(view.reserve).toBe(sim.weapon.res);
    expect(view.reloading).toBe(false);
    expect(view.squadOrder).toBe(SQUAD_ORDER_NAMES[0]);
    expect(view.tickets).toBe(sim.enemyTickets);
    expect(view.ticketsStart).toBe(DIFF.veteran.tickets);
    expect(view.zones.map((z) => z.name)).toEqual(['Far']);
    expect(view.reinforcements).toBe(sim.lives);
    // The legacy count includes the player: two operators and the player, all alive.
    expect(view.operatorsAlive).toBe(3);
    expect(view.operatorsTotal).toBe(3);
    expect(view.playerX).toBe(sim.player.pos.x);
    expect(view.playerZ).toBe(sim.player.pos.z);
  });

  it('gives the gadget and breach keys from the key labels, and the killstreak state', () => {
    const sim = openFieldSim();
    const view = buildHudView(sim, env, new HudState());
    expect(view.gadgets.map((g) => g.key)).toEqual(['GADGET1', 'GADGET2']);
    expect(view.breachKey).toBe('INTERACT');
    expect(view.killstreakKey).toBe('KILLSTREAK');
    expect(view.killstreakReady).toBeNull();
    expect(view.breachCharges).toBe(2);
  });

  it('reads the hit marker and the feed from the state, and clears the marker on read', () => {
    const state = new HudState();
    state.hit('head');
    state.feed('Resupplied', 'good');
    const sim = openFieldSim();
    const first = buildHudView(sim, env, state);
    expect(first.hitMarker).toBe('head');
    expect(first.feed).toEqual([{ text: 'Resupplied', cls: 'good' }]);
    expect(buildHudView(sim, env, state).hitMarker).toBe('none');
  });

  it('does not change the sim: the view is read-only', () => {
    const sim = openFieldSim();
    const before = {
      time: sim.time,
      pos: { ...sim.player.pos },
      yaw: sim.player.yaw,
      score: sim.score,
      tickets: sim.enemyTickets,
      ammo: sim.weapon.ammo,
    };
    buildHudView(sim, env, new HudState());
    buildHudExtras(sim, env);
    expect({
      time: sim.time,
      pos: { ...sim.player.pos },
      yaw: sim.player.yaw,
      score: sim.score,
      tickets: sim.enemyTickets,
      ammo: sim.weapon.ammo,
    }).toEqual(before);
    expect(sim.time).toBe(0);
  });

  it('shows the whiteout and the hurt fade from the sim, clamped to 0..1', () => {
    const sim = openFieldSim();
    sim.flashT = 1.5;
    sim.player.lastHurt = 0;
    sim.time = 0.45;
    const view = buildHudView(sim, env, new HudState());
    expect(view.whiteout).toBeCloseTo(0.5, 6);
    expect(view.hurt).toBeCloseTo(0.5, 6);
    sim.time = 10;
    expect(buildHudView(sim, env, new HudState()).hurt).toBe(0);
  });
});

describe('promptFor', () => {
  it('offers a resupply when a crate is in reach', () => {
    const sim = openFieldSim({ crates: [{ x: 0, z: 0 }] });
    expect(promptFor(sim, env)).toBe('[INTERACT] Resupply');
  });

  it('shows the armed breach charge with its time', () => {
    const sim = openFieldSim();
    sim.breach.plant = { box: 0, point: { x: 0, y: 0, z: 0 }, t: 2.2 };
    expect(promptFor(sim, env)).toBe('Breach charge armed · 2.2s');
  });

  it('is empty when nothing is in reach', () => {
    expect(promptFor(openFieldSim(), env)).toBe('');
  });

  it('is empty for a dead player', () => {
    const sim = openFieldSim({ crates: [{ x: 0, z: 0 }] });
    sim.player.alive = false;
    expect(promptFor(sim, env)).toBe('');
  });
});

describe('buildHudExtras and introKeys', () => {
  it('lists the squad with its positions, the spread and the squad order key', () => {
    const sim = openFieldSim();
    const extras = buildHudExtras(sim, env);
    expect(extras.operators).toHaveLength(2);
    expect(extras.operators?.[0]?.name).toBe('Ally 1');
    expect(extras.spread).toBe(sim.weapon.spread);
    expect(extras.orderKey).toBe('ORDER');
  });

  it('builds the intro hint keys, with the movement keys as one group', () => {
    const keys = introKeys(env);
    expect(keys.move).toBe('FORWARD LEFT BACK RIGHT');
    expect(keys.sprint).toBe('SPRINT');
    expect(keys.order).toBe('ORDER');
  });

  it('has a kill-feed line and a banner for each killstreak', () => {
    expect(KILLSTREAK_USED.uav.banner).toBe('UAV ONLINE');
    expect(KILLSTREAK_USED.sentry.feed).toBe('Sentry turret online');
    expect(KILLSTREAK_USED.airstrike.banner).toBe('AIRSTRIKE');
  });
});
