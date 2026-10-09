import type { Attachment, Perk, WeaponDef } from '../content/weapons';
import { spreadFor } from './ballistics';

export interface WeaponState {
  def: WeaponDef;
  attachment: Attachment;
  mag: number;
  ammo: number;
  res: number;
  cd: number;
  reloadLeft: number;
  spread: number;
  recoilMul: number;
  spreadMul: number;
  noisy: boolean;
}

export interface FireContext {
  ads: boolean;
  moving: boolean;
  sprinting: boolean;
  perk: Perk;
}

export interface FireResult {
  pellets: number;
  spread: number;
  recoilMul: number;
}

// Legacy: index.html:1289-1296.
export function makeWeaponState(def: WeaponDef, attachment: Attachment): WeaponState {
  const mag = attachment === 'extmag' ? Math.round(def.mag * 1.5) : def.mag;
  return {
    def,
    attachment,
    mag,
    ammo: mag,
    res: def.res,
    cd: 0,
    reloadLeft: 0,
    spread: def.spread,
    recoilMul: attachment === 'grip' ? 0.7 : 1,
    // The reflex factor is applied by spreadFor inside tryFire. It is recorded here
    // for inspection only, so it is not counted twice.
    spreadMul: attachment === 'reflex' ? 0.85 : 1,
    noisy: attachment !== 'suppressor',
  };
}

// Legacy: index.html:1809-1837.
export function tryFire(state: WeaponState, ctx: FireContext): FireResult | null {
  if (state.cd > 0 || state.reloadLeft > 0) return null;
  if (state.ammo <= 0) {
    startReload(state, ctx.perk);
    return null;
  }
  state.ammo -= 1;
  state.cd = 60 / state.def.rpm;
  const spread = spreadFor(state.def, {
    spread: state.spread,
    ads: ctx.ads,
    moving: ctx.moving,
    sprinting: ctx.sprinting,
    reflex: state.attachment === 'reflex',
  });
  state.spread = Math.min(state.def.spreadMax, state.spread + state.def.gain);
  const steady = ctx.perk === 'steady' ? 0.7 : 1;
  return { pellets: state.def.pellets, spread, recoilMul: state.recoilMul * steady };
}

// Legacy: index.html:1799-1803.
export function startReload(state: WeaponState, perk: Perk): boolean {
  if (state.reloadLeft > 0 || state.ammo >= state.mag || state.res <= 0) return false;
  state.reloadLeft = state.def.reload * (perk === 'fasthands' ? 0.7 : 1);
  return true;
}

// Legacy: index.html:1838-1854. Spread recovers at 0.5/s, doubled with Steady Aim.
export function tickWeapon(state: WeaponState, dt: number, firing: boolean, perk: Perk): void {
  state.cd = Math.max(0, state.cd - dt);
  if (state.reloadLeft > 0) {
    state.reloadLeft -= dt;
    if (state.reloadLeft <= 0) {
      state.reloadLeft = 0;
      const take = Math.min(state.mag - state.ammo, state.res);
      state.ammo += take;
      state.res -= take;
    }
  }
  if (!firing) {
    const rate = perk === 'steady' ? 1 : 0.5;
    state.spread = Math.max(state.def.spread, state.spread - dt * rate);
  }
}

// Legacy: index.html:1804-1808. The 0.35 s switch time is the caller's job.
// `next` stays in the signature so every switch passes both weapons; only `current` changes.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function switchTo(current: WeaponState, _next: WeaponState): void {
  current.reloadLeft = 0;
}
