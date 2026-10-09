import { describe, it, expect } from 'vitest';
import { WEAPONS } from '../../src/content/weapons';
import { WEAPON_SWITCH_TIME } from '../../src/sim/weapons';
import { DT, IDLE, openFieldSim, pressing } from './support/sim-fixtures';
import type { Command } from '../../src/input/commands';

// Legacy switchWeapon (index.html:1804-1808): keys 1 and 2 put the primary or the sidearm in hand, the switch takes
// 0.35 s, fire is blocked while it runs (index.html:1852), and a switch cancels a reload in progress.

// Fire held, as a mouse button press for one tick.
const FIRE: Command = { ...IDLE, buttons: { fire: true, ads: false } };

describe('weapon switching', () => {
  it('puts the other weapon in hand when its key is pressed', () => {
    const sim = openFieldSim();
    expect(sim.activeSlot).toBe(0);
    expect(sim.weapon).toBe(sim.primary);
    expect(sim.weapon.def.id).toBe('vx');

    sim.step(pressing('weapon2'), DT);
    expect(sim.activeSlot).toBe(1);
    expect(sim.weapon).toBe(sim.sidearm);
    expect(sim.weapon.def.id).toBe(WEAPONS.vp.id);

    // The switch back waits for the first switch to finish (a press during a switch is ignored).
    for (let i = 0; i < 25; i++) sim.step(IDLE, DT);
    expect(sim.switchT).toBe(0);
    sim.step(pressing('weapon1'), DT);
    expect(sim.activeSlot).toBe(0);
    expect(sim.weapon).toBe(sim.primary);
  });

  it('does nothing when the slot already in hand is asked for again', () => {
    const sim = openFieldSim();
    sim.weapon.ammo = 10;
    sim.step(pressing('reload'), DT);
    const reloadLeft = sim.primary.reloadLeft;
    expect(reloadLeft).toBeGreaterThan(0);

    sim.step(pressing('weapon1'), DT);
    expect(sim.activeSlot).toBe(0);
    expect(sim.switchT).toBe(0);
    expect(sim.primary.reloadLeft).toBeLessThan(reloadLeft);
    expect(sim.primary.reloadLeft).toBeGreaterThan(0);
  });

  it('ignores a second switch while one is running', () => {
    const sim = openFieldSim();
    sim.requestSwitch(1);
    sim.requestSwitch(0);
    expect(sim.activeSlot).toBe(1);
    expect(sim.switchT).toBe(WEAPON_SWITCH_TIME);
  });

  it('cancels a reload in progress, and the magazine is not refilled', () => {
    const sim = openFieldSim();
    sim.weapon.ammo = 10;
    sim.step(pressing('reload'), DT);
    expect(sim.primary.reloadLeft).toBeGreaterThan(0);

    sim.step(pressing('weapon2'), DT);
    expect(sim.primary.reloadLeft).toBe(0);
    expect(sim.primary.ammo).toBe(10);

    // Time passes well beyond the reload time, with the sidearm in hand.
    for (let i = 0; i < 200; i++) sim.step(IDLE, DT);
    expect(sim.primary.ammo).toBe(10);
    expect(sim.primary.reloadLeft).toBe(0);
  });

  it('blocks fire while the switch runs and fires again once it has ended', () => {
    const sim = openFieldSim();
    sim.step(pressing('weapon2'), DT);
    const shotsAtSwitch = sim.playerShots;
    const sidearmAmmo = sim.sidearm.ammo;

    // Held fire and a latched click for the first ticks of the switch. Stop before the timer runs out.
    for (let i = 0; i < 5; i++) sim.step(FIRE, DT, true);
    expect(sim.switchT).toBeGreaterThan(0);
    expect(sim.playerShots).toBe(shotsAtSwitch);
    expect(sim.sidearm.ammo).toBe(sidearmAmmo);

    // Once the timer runs out the sidearm fires, and the primary is untouched.
    const primaryAmmo = sim.primary.ammo;
    for (let i = 0; i < 30 && sim.playerShots === shotsAtSwitch; i++) sim.step(FIRE, DT, true);
    expect(sim.playerShots).toBeGreaterThan(shotsAtSwitch);
    expect(sim.sidearm.ammo).toBe(sidearmAmmo - 1);
    expect(sim.primary.ammo).toBe(primaryAmmo);
  });

  it('counts the switch time down from 0.35 s to zero', () => {
    expect(WEAPON_SWITCH_TIME).toBe(0.35);
    const sim = openFieldSim();
    sim.requestSwitch(1);
    expect(sim.switchT).toBe(WEAPON_SWITCH_TIME);

    sim.step(IDLE, 0.1);
    expect(sim.switchT).toBeCloseTo(0.25, 9);
    sim.step(IDLE, 0.1);
    expect(sim.switchT).toBeCloseTo(0.15, 9);
    sim.step(IDLE, 0.1);
    expect(sim.switchT).toBeCloseTo(0.05, 9);
    sim.step(IDLE, 0.1);
    expect(sim.switchT).toBe(0);
  });
});
