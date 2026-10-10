// Shared identifier lists. Every module that validates or switches on these IDs imports them from here.
// Order matches the legacy file's declaration order (index.html lines cited in each comment).

// index.html:473
export const DIFFICULTY_IDS = ['recruit', 'veteran', 'elite', 'nightmare'] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

// index.html:486-494 (primaries, then the sidearm)
export const PRIMARY_WEAPON_IDS = ['vx', 'kv', 'bk', 'lm', 'dm', 'rc', 'lb', 'hp'] as const;
export type PrimaryWeaponId = (typeof PRIMARY_WEAPON_IDS)[number];
export const SIDEARM_ID = 'vp' as const;

// index.html:496-502
export const ATTACHMENT_IDS = [
  'none',
  'suppressor',
  'extmag',
  'grip',
  'reflex',
  'compensator',
  'hollow',
] as const;
export type AttachmentId = (typeof ATTACHMENT_IDS)[number];

// index.html:504-509
export const PERK_IDS = ['steady', 'fasthands', 'lightweight', 'ghost', 'scavenger', 'adrenaline'] as const;
export type PerkId = (typeof PERK_IDS)[number];

// index.html:511-517
export const GADGET_IDS = ['frag', 'flash', 'smoke', 'medkit', 'drone', 'claymore', 'stim'] as const;
export type GadgetId = (typeof GADGET_IDS)[number];

// index.html:533-563
export const MAP_IDS = ['compound', 'substation', 'depot'] as const;
export type MapId = (typeof MAP_IDS)[number];

// index.html:578-584: the 17 rebindable actions, in the legacy order
export const ACTIONS = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'crouch',
  'sprint',
  'reload',
  'weapon1',
  'weapon2',
  'gadget1',
  'gadget2',
  'interact',
  'melee',
  'order',
  'killstreak',
  'scoreboard',
] as const;
export type Action = (typeof ACTIONS)[number];
