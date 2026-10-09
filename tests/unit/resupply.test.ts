import { describe, it, expect } from 'vitest';
import { WEAPONS } from '../../src/content/weapons';
import { GADGETS } from '../../src/content/gadgets';
import { createBreach } from '../../src/sim/breach';
import { createGadgetSlot, useGadget, type GadgetSlot } from '../../src/sim/gadgets';
import { makeWeaponState } from '../../src/sim/weapons';
import {
  CRATE_COOLDOWN,
  createCrates,
  nearestCrate,
  resupply,
  stepCrates,
  type CrateState,
} from '../../src/sim/resupply';

// Test helper: the element at index i, failing the test if it is missing.
function at<T>(items: readonly T[], i: number): T {
  const v = items[i];
  if (v === undefined) throw new Error(`no element at ${String(i)}`);
  return v;
}

function crateRow(): CrateState[] {
  return createCrates([
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 5, z: 0 },
  ]);
}

describe('createCrates', () => {
  it('starts every crate ready', () => {
    const crates = crateRow();
    expect(crates).toHaveLength(3);
    expect(crates.every((c) => c.cd === 0)).toBe(true);
  });
});

describe('nearestCrate', () => {
  it('returns the nearest crate within 2.4 m', () => {
    const crates = crateRow();
    expect(nearestCrate(crates, { x: 0.8, z: 0 })).toBe(at(crates, 1));
  });

  it('returns null when no crate is in reach', () => {
    expect(nearestCrate(crateRow(), { x: 10, z: 0 })).toBeNull();
    // 2.4 m exactly is out of reach (strictly inside only).
    expect(nearestCrate(crateRow(), { x: -2.4, z: 0 })).toBeNull();
  });

  it('ignores crates on cooldown', () => {
    const crates = crateRow();
    at(crates, 1).cd = 5;
    expect(nearestCrate(crates, { x: 0.8, z: 0 })).toBe(at(crates, 0));
    at(crates, 0).cd = 1;
    expect(nearestCrate(crates, { x: 0.8, z: 0 })).toBeNull();
  });
});

describe('resupply', () => {
  function loadout(): {
    weapons: ReturnType<typeof makeWeaponState>[];
    gadgets: GadgetSlot[];
    breach: ReturnType<typeof createBreach>;
    player: { hp: number; stamina: number };
  } {
    return {
      weapons: [makeWeaponState(WEAPONS.vx, 'none'), makeWeaponState(WEAPONS.vp, 'none')],
      gadgets: [createGadgetSlot('frag'), createGadgetSlot('drone')],
      breach: createBreach(),
      player: { hp: 20, stamina: 0.1 },
    };
  }

  it('restores ammo, reserve, gadget uses, charges, hp and stamina, and starts the 30 s cooldown', () => {
    const target = loadout();
    for (const w of target.weapons) {
      w.ammo = 0;
      w.res = 0;
    }
    at(target.gadgets, 0).uses = 0;
    at(target.gadgets, 1).uses = 0;
    target.breach.charges = 0;

    const crate = at(crateRow(), 0);
    expect(resupply(target, crate)).toBe(true);

    for (const w of target.weapons) {
      expect(w.ammo).toBe(w.mag);
      expect(w.res).toBe(w.def.res);
    }
    expect(at(target.gadgets, 0).uses).toBe(GADGETS.frag.uses);
    expect(at(target.gadgets, 1).uses).toBe(GADGETS.drone.uses);
    expect(target.breach.charges).toBe(2);
    expect(target.player.hp).toBe(100);
    expect(target.player.stamina).toBe(1);
    expect(crate.cd).toBe(30);
    expect(CRATE_COOLDOWN).toBe(30);
  });

  it('refills gadgets used during a life', () => {
    const target = loadout();
    const living = { hp: 20, alive: true };
    const r = useGadget(target.gadgets, 0, living, { x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 1 }, null);
    expect(r.used).toBe(true);
    expect(at(target.gadgets, 0).uses).toBe(1);
    resupply(target, at(crateRow(), 0));
    expect(at(target.gadgets, 0).uses).toBe(2);
  });

  it('does nothing while the crate is on cooldown', () => {
    const target = loadout();
    target.player.hp = 20;
    const crate: CrateState = { pos: { x: 0, z: 0 }, cd: 12 };
    expect(resupply(target, crate)).toBe(false);
    expect(target.player.hp).toBe(20);
    expect(crate.cd).toBe(12);
  });
});

describe('stepCrates', () => {
  it('counts the cooldown down and returns the crate to service after 30 s', () => {
    const crates = crateRow();
    const target = {
      weapons: [makeWeaponState(WEAPONS.vx, 'none')],
      gadgets: [createGadgetSlot('frag')],
      breach: createBreach(),
      player: { hp: 100, stamina: 1 },
    };
    const crate = at(crates, 1);
    resupply(target, crate);
    expect(crate.cd).toBe(30);
    expect(nearestCrate(crates, { x: 1, z: 0 })).not.toBe(crate);

    stepCrates(crates, 10);
    expect(crate.cd).toBe(20);
    expect(nearestCrate(crates, { x: 1, z: 0 })).not.toBe(crate);

    // 20 more seconds, in whole steps so the sum is exact.
    stepCrates(crates, 10);
    stepCrates(crates, 10);
    expect(crate.cd).toBe(0);
    expect(nearestCrate(crates, { x: 1, z: 0 })).toBe(crate);
  });

  it('never takes the cooldown below zero', () => {
    const crates = crateRow();
    stepCrates(crates, 5);
    expect(crates.every((c) => c.cd === 0)).toBe(true);
  });
});
