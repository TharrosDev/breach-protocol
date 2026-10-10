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
  // Shots still to come in the burst under way (burst weapons only). Zero when no burst is running.
  burstLeft: number;
  // Multiplier on the spread gained per shot (compensator).
  gainMul: number;
  // Multiplier on the damage of every hit (hollow point).
  damageMul: number;
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

// Compensator: 25% less recoil and 40% less spread bloom while firing.
export const COMPENSATOR_RECOIL = 0.75;
export const COMPENSATOR_GAIN = 0.6;
// Hollow point: +20% damage per hit for 25% less reserve ammo.
export const HOLLOW_DAMAGE = 1.2;
export const HOLLOW_RES_MUL = 0.75;

// Legacy: index.html:1289-1296.
export function makeWeaponState(def: WeaponDef, attachment: Attachment): WeaponState {
  const mag = attachment === 'extmag' ? Math.round(def.mag * 1.5) : def.mag;
  return {
    def,
    attachment,
    mag,
    ammo: mag,
    res: attachment === 'hollow' ? Math.round(def.res * HOLLOW_RES_MUL) : def.res,
    cd: 0,
    reloadLeft: 0,
    spread: def.spread,
    recoilMul: attachment === 'grip' ? 0.7 : attachment === 'compensator' ? COMPENSATOR_RECOIL : 1,
    // The reflex factor is applied by spreadFor inside tryFire. It is recorded here
    // for inspection only, so it is not counted twice.
    spreadMul: attachment === 'reflex' ? 0.85 : 1,
    noisy: attachment !== 'suppressor',
    burstLeft: 0,
    gainMul: attachment === 'compensator' ? COMPENSATOR_GAIN : 1,
    damageMul: attachment === 'hollow' ? HOLLOW_DAMAGE : 1,
  };
}

// Legacy: index.html:1809-1837.
export function tryFire(state: WeaponState, ctx: FireContext): FireResult | null {
  if (state.cd > 0 || state.reloadLeft > 0) return null;
  if (state.ammo <= 0) {
    state.burstLeft = 0;
    startReload(state, ctx.perk);
    return null;
  }
  state.ammo -= 1;
  state.cd = 60 / state.def.rpm;
  advanceBurst(state);
  const spread = spreadFor(state.def, {
    spread: state.spread,
    ads: ctx.ads,
    moving: ctx.moving,
    sprinting: ctx.sprinting,
    reflex: state.attachment === 'reflex',
  });
  state.spread = Math.min(state.def.spreadMax, state.spread + state.def.gain * state.gainMul);
  const steady = ctx.perk === 'steady' ? 0.7 : 1;
  return { pellets: state.def.pellets, spread, recoilMul: state.recoilMul * steady };
}

// Burst fire: the first pull queues the rest of the burst (the world keeps pulling the trigger while burstLeft is
// above zero), and the last shot of a burst adds the weapon's gap before the next one.
function advanceBurst(state: WeaponState): void {
  const burst = state.def.burst ?? 1;
  if (burst <= 1) return;
  if (state.burstLeft > 0) state.burstLeft -= 1;
  else state.burstLeft = burst - 1;
  if (state.burstLeft === 0) state.cd += state.def.burstGap ?? 0;
}

// Legacy: index.html:1799-1803.
export function startReload(state: WeaponState, perk: Perk): boolean {
  if (state.reloadLeft > 0 || state.ammo >= state.mag || state.res <= 0) return false;
  state.burstLeft = 0;
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

// Legacy: index.html:1807 (P.switchT = 0.35). Fire is blocked until it runs out (index.html:1852).
export const WEAPON_SWITCH_TIME = 0.35;

// Legacy: index.html:1804-1808. Cancels a reload in progress on the weapon being put away. The switch time is set by
// SimWorld.requestSwitch (WEAPON_SWITCH_TIME).
// `next` stays in the signature so every switch passes both weapons; only `current` changes.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function switchTo(current: WeaponState, _next: WeaponState): void {
  current.reloadLeft = 0;
  current.burstLeft = 0;
}
