import { describe, it, expect, vi } from 'vitest';
import { getMap } from '../../src/content/maps';
import { GADGETS } from '../../src/content/gadgets';
import { CRATE_COOLDOWN } from '../../src/sim/resupply';
import { BREACH_CHARGES } from '../../src/sim/breach';
import type { SimEvent, SimWorld } from '../../src/sim/world';
import { DT, IDLE, compoundSim, makeEnemy, openFieldSim, pressing } from './support/sim-fixtures';
import type { Command } from '../../src/input/commands';
import type { Action } from '../../src/content/ids';

// Phase 4 gadget, resupply and breach rules, run through SimWorld.

function run(sim: SimWorld, seconds: number, cmd: Command = IDLE): SimEvent[] {
  const out: SimEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) out.push(...sim.step(cmd, DT));
  return out;
}

function press(sim: SimWorld, action: Action): SimEvent[] {
  return sim.step(pressing(action), DT);
}

describe('loadout gadgets', () => {
  it('throwing a frag uses one of its two uses and puts a grenade in flight', () => {
    const sim = openFieldSim();
    expect(sim.gadgets[0]?.uses).toBe(GADGETS.frag.uses);

    press(sim, 'gadget1');

    expect(sim.gadgets[0]?.uses).toBe(GADGETS.frag.uses - 1);
    expect(sim.grenades).toHaveLength(1);
    expect(sim.grenades[0]?.owner).toBe('player');
    expect(sim.grenades[0]?.kind).toBe('frag');
  });

  it('a slot with no uses left does nothing', () => {
    const sim = openFieldSim();
    press(sim, 'gadget1');
    press(sim, 'gadget1');
    expect(sim.gadgets[0]?.uses).toBe(0);
    expect(sim.grenades).toHaveLength(2);

    press(sim, 'gadget1');

    expect(sim.gadgets[0]?.uses).toBe(0);
    expect(sim.grenades).toHaveLength(2);
  });

  it('the frag explodes after its fuse and is removed from flight', () => {
    const sim = openFieldSim();
    press(sim, 'gadget1');

    const events = run(sim, 3);

    expect(sim.grenades).toHaveLength(0);
    expect(events.some((ev) => ev.type === 'grenadeBlast')).toBe(true);
  });

  it('a smoke in slot 2 lingers for its life, and then clears', () => {
    const sim = openFieldSim();
    press(sim, 'gadget2');
    expect(sim.gadgets[1]?.uses).toBe(GADGETS.smoke.uses - 1);

    run(sim, 2.5);
    expect(sim.smokes).toHaveLength(1);

    run(sim, 9);
    expect(sim.smokes).toHaveLength(0);
  });

  it('a recon drone flies for 10 s, spots a hostile within 22 m, and then ends', () => {
    const sim = openFieldSim({ gadgets: ['drone', 'smoke'] });
    const near = makeEnemy('rifle', 0, 15);
    const far = makeEnemy('rifle', 0, 40);
    sim.enemies.push(near, far);

    press(sim, 'gadget1');
    expect(sim.drone).not.toBeNull();
    expect(sim.gadgets[0]?.uses).toBe(0);

    run(sim, 1);
    expect(near.spot).toBeGreaterThan(0);
    // AI decays spot each tick, so an unspotted hostile sits at or below zero.
    expect(far.spot).toBeLessThanOrEqual(0);

    run(sim, 10);
    expect(sim.drone).toBeNull();
  });
});

describe('resupply crates', () => {
  it('a crate in reach restores ammo, gadget uses, breach charges, hp and stamina, then cools down for 30 s', () => {
    const sim = openFieldSim({ crates: [{ x: 5, z: 0 }] });
    sim.player.pos = { x: 5, y: 0, z: 0 };
    sim.weapon.ammo = 3;
    if (sim.gadgets[0] !== undefined) sim.gadgets[0].uses = 0;
    sim.breach.charges = 0;
    sim.player.hp = 40;
    sim.player.stamina = 0.1;

    const events = press(sim, 'interact');

    expect(sim.weapon.ammo).toBe(sim.weapon.mag);
    expect(sim.weapon.res).toBe(sim.weapon.def.res);
    expect(sim.gadgets[0]?.uses).toBe(GADGETS.frag.uses);
    expect(sim.breach.charges).toBe(BREACH_CHARGES);
    expect(sim.player.hp).toBe(100);
    expect(sim.player.stamina).toBe(1);
    expect(events.some((ev) => ev.type === 'resupplied')).toBe(true);
    // The cooldown starts this tick, and the same tick's step already counts one tick off it.
    expect(sim.crates[0]?.cd).toBeCloseTo(CRATE_COOLDOWN, 1);

    // A second press during the cooldown restores nothing.
    sim.weapon.ammo = 3;
    const again = press(sim, 'interact');
    expect(sim.weapon.ammo).toBe(3);
    expect(again.some((ev) => ev.type === 'resupplied')).toBe(false);

    // After the cooldown the crate works again.
    run(sim, CRATE_COOLDOWN + 1);
    press(sim, 'interact');
    expect(sim.weapon.ammo).toBe(sim.weapon.mag);
  });

  it('out of reach, interact does not resupply', () => {
    const sim = openFieldSim({ crates: [{ x: 5, z: 0 }] });
    sim.weapon.ammo = 3;
    press(sim, 'interact');
    expect(sim.weapon.ammo).toBe(3);
  });
});

describe('breach charge on Compound', () => {
  it('a plant on a breakable wall arms, explodes after 2.2 s, removes the wall and rebuilds the nav grid', () => {
    const { sim, collision } = compoundSim();
    const wall = getMap('compound').boxes.find((b) => b.breakable);
    if (wall === undefined) throw new RangeError('Compound has a breakable wall');
    // Stand 1.2 m short of the wall's low-x face, facing +x, at head height.
    const zc = (wall.min.z + wall.max.z) / 2;
    sim.player.pos = { x: wall.min.x - 1.2, y: 0, z: zc };
    sim.player.yaw = Math.PI / 2;
    sim.player.pitch = 0;
    sim.enemies = [];

    press(sim, 'interact');

    expect(sim.breach.charges).toBe(BREACH_CHARGES - 1);
    expect(sim.breach.plant).not.toBeNull();

    const rebuild = vi.spyOn(sim.nav, 'rebuild');
    const colliders = collision.footprints().length;

    const early = run(sim, 2.0);
    expect(early.some((ev) => ev.type === 'breachBlast')).toBe(false);
    expect(sim.breach.plant).not.toBeNull();

    const late = run(sim, 0.4);
    expect(late.some((ev) => ev.type === 'breachBlast')).toBe(true);
    expect(sim.breach.plant).toBeNull();
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(collision.footprints()).toHaveLength(colliders - 1);
  });
});
