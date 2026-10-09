import { describe, it, expect } from 'vitest';
import { WEAPONS } from '../../src/content/weapons';
import type { Perk } from '../../src/content/weapons';
import { makeWeaponState, startReload, switchTo, tickWeapon, tryFire } from '../../src/sim/weapons';
import type { FireContext } from '../../src/sim/weapons';

// 'lightweight' has no effect on any value checked here.
const NO_PERK: Perk = 'lightweight';

const ctx: FireContext = { ads: false, moving: false, sprinting: false, perk: NO_PERK };
const withPerk = (perk: Perk): FireContext => ({ ...ctx, perk });

describe('tryFire', () => {
  it('VX cooldown after one shot is 60 / 690 s', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    expect(tryFire(w, ctx)).not.toBeNull();
    expect(w.cd).toBeCloseTo(60 / 690, 10);
  });

  it('returns null while cooling down and fires again after the cooldown', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    tryFire(w, ctx);
    expect(tryFire(w, ctx)).toBeNull();
    tickWeapon(w, 60 / 690, false, NO_PERK);
    expect(tryFire(w, ctx)).not.toBeNull();
  });

  it('Breaker fires 9 pellets', () => {
    const w = makeWeaponState(WEAPONS.bk, 'none');
    expect(tryFire(w, ctx)?.pellets).toBe(9);
  });

  it('with an empty magazine returns null and starts a reload', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    w.ammo = 0;
    expect(tryFire(w, ctx)).toBeNull();
    expect(w.reloadLeft).toBeCloseTo(2.1, 10);
  });

  it('does not fire while reloading', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    w.ammo = 29;
    startReload(w, NO_PERK);
    expect(tryFire(w, ctx)).toBeNull();
    expect(w.ammo).toBe(29);
  });

  it('spread grows by gain and is capped at spreadMax', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    tryFire(w, ctx);
    expect(w.spread).toBeCloseTo(0.01 + 0.005, 10);
    for (let i = 0; i < 20; i++) {
      tickWeapon(w, 60 / 690, true, NO_PERK);
      tryFire(w, ctx);
    }
    expect(w.spread).toBeCloseTo(WEAPONS.vx.spreadMax, 10);
  });

  it('reports the spread used for this shot, before growth', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    expect(tryFire(w, ctx)?.spread).toBeCloseTo(0.01, 10);
  });

  it('applies the reflex factor to the reported spread once', () => {
    const w = makeWeaponState(WEAPONS.vx, 'reflex');
    expect(tryFire(w, ctx)?.spread).toBeCloseTo(0.01 * 0.85, 10);
  });

  it('Steady Aim multiplies recoilMul by 0.7', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    expect(tryFire(w, withPerk('steady'))?.recoilMul).toBeCloseTo(0.7, 10);
  });

  it('grip gives recoilMul 0.7 and no perk gives 1', () => {
    expect(tryFire(makeWeaponState(WEAPONS.vx, 'grip'), ctx)?.recoilMul).toBeCloseTo(0.7, 10);
    expect(tryFire(makeWeaponState(WEAPONS.vx, 'none'), ctx)?.recoilMul).toBe(1);
  });
});

describe('makeWeaponState', () => {
  it('extended mag gives 45 rounds and starts full', () => {
    const w = makeWeaponState(WEAPONS.vx, 'extmag');
    expect(w.mag).toBe(45);
    expect(w.ammo).toBe(45);
  });

  it('suppressor makes the weapon quiet', () => {
    expect(makeWeaponState(WEAPONS.vx, 'suppressor').noisy).toBe(false);
    expect(makeWeaponState(WEAPONS.vx, 'none').noisy).toBe(true);
  });

  it('reflex records spreadMul 0.85', () => {
    expect(makeWeaponState(WEAPONS.vx, 'reflex').spreadMul).toBeCloseTo(0.85, 10);
  });
});

describe('reload', () => {
  it('a full empty magazine reloads in exactly 2.1 s and moves min(30, 150) rounds', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    w.ammo = 0;
    expect(startReload(w, NO_PERK)).toBe(true);
    expect(w.reloadLeft).toBe(2.1);
    tickWeapon(w, 2.1, false, NO_PERK);
    expect(w.reloadLeft).toBe(0);
    expect(w.ammo).toBe(30);
    expect(w.res).toBe(120);
  });

  it('a reload is still in progress before 2.1 s have passed', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    w.ammo = 0;
    startReload(w, NO_PERK);
    tickWeapon(w, 2.0, false, NO_PERK);
    expect(w.reloadLeft).toBeGreaterThan(0);
    expect(w.ammo).toBe(0);
    expect(w.res).toBe(150);
  });

  it('Fast Hands reload takes 2.1 x 0.7 s', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    w.ammo = 0;
    startReload(w, 'fasthands');
    expect(w.reloadLeft).toBeCloseTo(2.1 * 0.7, 10);
    tickWeapon(w, 1.4, false, 'fasthands');
    expect(w.ammo).toBe(0);
    tickWeapon(w, 0.1, false, 'fasthands');
    expect(w.ammo).toBe(30);
  });

  it('a partial reload only moves the rounds needed to fill the magazine', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    w.ammo = 25;
    startReload(w, NO_PERK);
    tickWeapon(w, 2.1, false, NO_PERK);
    expect(w.ammo).toBe(30);
    expect(w.res).toBe(145);
  });

  it('does not start when the magazine is full or there is no reserve', () => {
    const full = makeWeaponState(WEAPONS.vx, 'none');
    expect(startReload(full, NO_PERK)).toBe(false);
    const dry = makeWeaponState(WEAPONS.vx, 'none');
    dry.ammo = 0;
    dry.res = 0;
    expect(startReload(dry, NO_PERK)).toBe(false);
  });

  it('switchTo during a reload cancels it', () => {
    const vx = makeWeaponState(WEAPONS.vx, 'none');
    const kv = makeWeaponState(WEAPONS.kv, 'none');
    vx.ammo = 0;
    startReload(vx, NO_PERK);
    switchTo(vx, kv);
    expect(vx.reloadLeft).toBe(0);
    expect(vx.ammo).toBe(0);
    expect(vx.res).toBe(150);
  });
});

describe('spread recovery', () => {
  it('recovers at 0.5 per second when not firing, floored at the base spread', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    w.spread = 0.02;
    tickWeapon(w, 0.01, false, NO_PERK);
    expect(w.spread).toBeCloseTo(0.02 - 0.005, 10);
    tickWeapon(w, 1, false, NO_PERK);
    expect(w.spread).toBe(WEAPONS.vx.spread);
  });

  it('does not recover while firing', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    w.spread = 0.02;
    tickWeapon(w, 1, true, NO_PERK);
    expect(w.spread).toBeCloseTo(0.02, 10);
  });

  it('Steady Aim doubles the recovery rate', () => {
    const w = makeWeaponState(WEAPONS.vx, 'none');
    w.spread = 0.04;
    tickWeapon(w, 0.01, false, 'steady');
    expect(w.spread).toBeCloseTo(0.04 - 0.01, 10);
  });
});
