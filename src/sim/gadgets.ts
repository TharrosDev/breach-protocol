import type { GadgetId } from '../content/ids';
import { GADGETS } from '../content/gadgets';
import type { Vec3 } from '../core/math';
import { PLAYER_MAX_HP } from './health';
import { launchDrone, type DroneState } from './drone';
import { placeMine, type Mine } from './mines';
import { playerThrow, type Grenade, type GrenadeKind } from './grenades';

// Loadout gadgets: uses and the use action. Ported from the legacy game: GADGETS (index.html:511-517),
// useMedkit (2005-2009), useGadget (2010-2018).

// index.html:2005-2009 (medkit restores 50 hp, capped at 100).
export const MEDKIT_HEAL = 50;

// One loadout slot. uses counts down from GADGETS[id].uses.
export interface GadgetSlot {
  id: GadgetId;
  uses: number;
}

export function createGadgetSlot(id: GadgetId): GadgetSlot {
  return { id, uses: GADGETS[id].uses };
}

export type GadgetUse =
  | { used: false }
  | { used: true; kind: 'medkit'; healed: number }
  | { used: true; kind: 'grenade'; grenade: Grenade }
  | { used: true; kind: 'drone'; drone: DroneState }
  | { used: true; kind: 'mine'; mine: Mine }
  | { used: true; kind: 'stim'; seconds: number };

// The player fields a gadget touches. PlayerHealth and PlayerState both satisfy this.
export interface GadgetUser {
  hp: number;
  alive: boolean;
  // Feet position. Optional so a bare hp record still satisfies the type; a mine falls back to under the eye.
  pos?: Vec3;
}

// Seconds a stim shot lasts.
export const STIM_TIME = 8;

// Uses the gadget in slot index (0 or 1). Ignored (used: false, nothing changes) when the player is dead, the
// slot is empty, a medkit is used at full health, or a drone is already flying.
//   medkit: hp is raised by MEDKIT_HEAL up to PLAYER_MAX_HP and the healed amount is returned.
//   drone: the caller stores the returned drone and passes it back as `drone` while it flies.
//   frag, flash, smoke: returns a grenade thrown from eye along aim (normalised). The caller pushes it onto its
//   grenade list.
// On success the slot's uses drop by one.
export function useGadget(
  slots: GadgetSlot[],
  index: 0 | 1,
  player: GadgetUser,
  eye: Vec3,
  aim: Vec3,
  drone: DroneState | null,
): GadgetUse {
  if (!player.alive) return { used: false };
  const slot = slots[index];
  if (slot === undefined || slot.uses <= 0) return { used: false };

  const result = applyGadget(slot.id, player, eye, aim, drone);
  if (!result.used) return result;
  slot.uses -= 1;
  return result;
}

function applyGadget(
  id: GadgetId,
  player: GadgetUser,
  eye: Vec3,
  aim: Vec3,
  drone: DroneState | null,
): GadgetUse {
  switch (id) {
    case 'medkit':
      return useMedkit(player);
    case 'drone':
      if (drone !== null) return { used: false };
      return { used: true, kind: 'drone', drone: launchDrone(eye, aim) };
    case 'claymore': {
      const feet = player.pos ?? { x: eye.x, y: 0, z: eye.z };
      return { used: true, kind: 'mine', mine: placeMine(feet, aim) };
    }
    case 'stim':
      return { used: true, kind: 'stim', seconds: STIM_TIME };
    case 'frag':
      return throwKind('frag', eye, aim);
    case 'flash':
      return throwKind('flash', eye, aim);
    case 'smoke':
      return throwKind('smoke', eye, aim);
  }
}

function useMedkit(player: GadgetUser): GadgetUse {
  if (player.hp >= PLAYER_MAX_HP) return { used: false };
  const before = player.hp;
  player.hp = Math.min(PLAYER_MAX_HP, before + MEDKIT_HEAL);
  return { used: true, kind: 'medkit', healed: player.hp - before };
}

function throwKind(kind: GrenadeKind, eye: Vec3, aim: Vec3): GadgetUse {
  return { used: true, kind: 'grenade', grenade: playerThrow(kind, eye, aim) };
}
