import type { Vec2 } from '../core/math';
import { GADGETS } from '../content/gadgets';
import { PLAYER_MAX_HP } from './health';
import { BREACH_CHARGES, type BreachState } from './breach';
import type { GadgetSlot } from './gadgets';
import type { WeaponState } from './weapons';

// Resupply crates. Ported from the legacy game: nearestCrate (index.html:3223-3226), resupply (3227-3234) and
// tryInteract (3236-3241, the crate branch). Only the crate and its cooldown are owned here; the loadout is
// passed in.

// index.html:3223-3234 (reach 2.4 m, 30 s cooldown per crate).
export const CRATE_REACH = 2.4;
export const CRATE_COOLDOWN = 30;

// Legacy stamina after resupply (index.html:3233).
const RESUPPLY_STAMINA = 1;

export interface CrateState {
  pos: Vec2;
  // Seconds until the crate can resupply again. Zero or less means it is ready.
  cd: number;
}

// One crate per position, all ready.
export function createCrates(positions: readonly Vec2[]): CrateState[] {
  return positions.map((p) => ({ pos: { x: p.x, z: p.z }, cd: 0 }));
}

// Nearest crate within reach (XZ) of pos that is off cooldown, or null. Crates on cooldown are ignored.
export function nearestCrate(
  crates: readonly CrateState[],
  pos: Vec2,
  reach = CRATE_REACH,
): CrateState | null {
  let best: CrateState | null = null;
  let bestD2 = reach * reach;
  for (const c of crates) {
    if (c.cd > 0) continue;
    const d2 = (c.pos.x - pos.x) ** 2 + (c.pos.z - pos.z) ** 2;
    if (d2 < bestD2) {
      best = c;
      bestD2 = d2;
    }
  }
  return best;
}

// What a crate restores. The caller passes its loadout (weapons, gadget slots, breach charges) and the player's
// hp and stamina. The caller checks that the player is alive, as legacy tryInteract does.
export interface ResupplyTarget {
  weapons: WeaponState[];
  gadgets: GadgetSlot[];
  breach: BreachState;
  player: { hp: number; stamina: number };
}

// Refills ammo (magazine and reserve), gadget uses, breach charges, hp and stamina, and starts the crate's
// 30 s cooldown. Returns false and changes nothing when the crate is still on cooldown.
// Port of resupply (index.html:3227-3234).
export function resupply(target: ResupplyTarget, crate: CrateState): boolean {
  if (crate.cd > 0) return false;
  for (const w of target.weapons) {
    w.ammo = w.mag;
    w.res = w.def.res;
  }
  for (const g of target.gadgets) {
    g.uses = GADGETS[g.id].uses;
  }
  target.breach.charges = BREACH_CHARGES;
  target.player.hp = PLAYER_MAX_HP;
  target.player.stamina = RESUPPLY_STAMINA;
  crate.cd = CRATE_COOLDOWN;
  return true;
}

// Counts every crate's cooldown down by dt, not below zero.
export function stepCrates(crates: CrateState[], dt: number): void {
  for (const c of crates) {
    c.cd = Math.max(0, c.cd - dt);
  }
}
