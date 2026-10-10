// Keeps a loadout inside what the player's rank has unlocked. A stored loadout from before the profile existed, or a
// hand-edited one, may name items that are still locked; those fall back to the defaults.
import { GADGET_IDS, type GadgetId } from '../content/ids';
import { isUnlocked } from '../content/progression';
import { DEFAULT_LOADOUT, type Loadout } from '../persist/schema';

export function loadoutLocks(loadout: Loadout, rank: number): string[] {
  const locked: string[] = [];
  if (!isUnlocked('weapon', loadout.primary, rank)) locked.push(loadout.primary);
  if (!isUnlocked('attachment', loadout.attachment, rank)) locked.push(loadout.attachment);
  if (!isUnlocked('perk', loadout.perk, rank)) locked.push(loadout.perk);
  for (const g of loadout.gadgets) if (!isUnlocked('gadget', g, rank)) locked.push(g);
  if (!isUnlocked('difficulty', loadout.difficulty, rank)) locked.push(loadout.difficulty);
  return locked;
}

export function enforceUnlocks(loadout: Loadout, rank: number): Loadout {
  const gadgets: GadgetId[] = [];
  for (const g of loadout.gadgets) {
    if (isUnlocked('gadget', g, rank) && !gadgets.includes(g)) gadgets.push(g);
  }
  for (const g of [...DEFAULT_LOADOUT.gadgets, ...GADGET_IDS]) {
    if (gadgets.length >= 2) break;
    if (isUnlocked('gadget', g, rank) && !gadgets.includes(g)) gadgets.push(g);
  }
  const [first, second] = gadgets;
  return {
    ...loadout,
    primary: isUnlocked('weapon', loadout.primary, rank) ? loadout.primary : DEFAULT_LOADOUT.primary,
    attachment: isUnlocked('attachment', loadout.attachment, rank)
      ? loadout.attachment
      : DEFAULT_LOADOUT.attachment,
    perk: isUnlocked('perk', loadout.perk, rank) ? loadout.perk : DEFAULT_LOADOUT.perk,
    gadgets: [first ?? DEFAULT_LOADOUT.gadgets[0], second ?? DEFAULT_LOADOUT.gadgets[1]],
    difficulty: isUnlocked('difficulty', loadout.difficulty, rank)
      ? loadout.difficulty
      : DEFAULT_LOADOUT.difficulty,
  };
}
