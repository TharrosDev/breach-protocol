// Progression tables: ranks and their XP, the unlock schedule and weapon mastery. Pure data and small lookups, so the
// menus, the debrief and the profile code all read one source.
import type { AttachmentId, DifficultyId, GadgetId, PerkId, PrimaryWeaponId } from './ids';

export const MAX_RANK = 30;

// XP needed to go from rank r to rank r + 1. It grows by 120 per rank, so rank 10 is about 7 matches in.
export function xpToNext(rank: number): number {
  const r = Math.max(1, Math.floor(rank));
  return 500 + (r - 1) * 120;
}

// Total XP at which a rank starts. Rank 1 starts at 0.
export function xpAtRank(rank: number): number {
  const target = Math.min(MAX_RANK, Math.max(1, Math.floor(rank)));
  let total = 0;
  for (let r = 1; r < target; r++) total += xpToNext(r);
  return total;
}

export const MAX_XP = xpAtRank(MAX_RANK);

export interface RankInfo {
  rank: number;
  // XP earned inside the current rank, and what the rank needs. At the top rank both are 0.
  into: number;
  needed: number;
  // 0..1 progress through the rank. 1 at the top rank.
  fraction: number;
  maxed: boolean;
}

export function rankFromXp(xp: number): RankInfo {
  const total = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  let rank = 1;
  let rest = total;
  while (rank < MAX_RANK && rest >= xpToNext(rank)) {
    rest -= xpToNext(rank);
    rank += 1;
  }
  if (rank >= MAX_RANK) return { rank: MAX_RANK, into: 0, needed: 0, fraction: 1, maxed: true };
  const needed = xpToNext(rank);
  return { rank, into: Math.floor(rest), needed, fraction: rest / needed, maxed: false };
}

const RANK_TITLES = [
  'Recruit',
  'Private',
  'Corporal',
  'Sergeant',
  'Lieutenant',
  'Captain',
  'Major',
  'Colonel',
  'Commander',
  'Legend',
] as const;

// Three ranks to a title.
export function rankTitle(rank: number): string {
  const index = Math.min(RANK_TITLES.length - 1, Math.max(0, Math.floor((rank - 1) / 3)));
  return RANK_TITLES[index] ?? 'Recruit';
}

export type UnlockKind = 'weapon' | 'attachment' | 'perk' | 'gadget' | 'difficulty';

// The rank each item opens at. Rank 1 items are available from the first launch.
export const WEAPON_UNLOCK: Readonly<Record<PrimaryWeaponId, number>> = {
  vx: 1,
  kv: 1,
  bk: 3,
  dm: 5,
  hp: 7,
  rc: 9,
  lm: 12,
  lb: 15,
};

export const ATTACHMENT_UNLOCK: Readonly<Record<AttachmentId, number>> = {
  none: 1,
  reflex: 1,
  grip: 1,
  suppressor: 2,
  extmag: 4,
  compensator: 6,
  hollow: 10,
};

export const PERK_UNLOCK: Readonly<Record<PerkId, number>> = {
  steady: 1,
  lightweight: 1,
  fasthands: 3,
  ghost: 5,
  scavenger: 8,
  adrenaline: 11,
};

export const GADGET_UNLOCK: Readonly<Record<GadgetId, number>> = {
  frag: 1,
  smoke: 1,
  medkit: 1,
  flash: 2,
  drone: 6,
  claymore: 8,
  stim: 10,
};

export const DIFFICULTY_UNLOCK: Readonly<Record<DifficultyId, number>> = {
  recruit: 1,
  veteran: 1,
  elite: 4,
  nightmare: 13,
};

export function unlockRank(kind: UnlockKind, id: string): number {
  const table: Readonly<Record<string, number>> = {
    weapon: WEAPON_UNLOCK,
    attachment: ATTACHMENT_UNLOCK,
    perk: PERK_UNLOCK,
    gadget: GADGET_UNLOCK,
    difficulty: DIFFICULTY_UNLOCK,
  }[kind];
  return table[id] ?? 1;
}

export function isUnlocked(kind: UnlockKind, id: string, rank: number): boolean {
  return unlockRank(kind, id) <= rank;
}

export interface UnlockEntry {
  kind: UnlockKind;
  id: string;
  rank: number;
}

// Everything that opens at exactly the ranks in (from, to], in rank order. Used for the debrief's "new unlocks".
export function unlocksBetween(from: number, to: number): UnlockEntry[] {
  const out: UnlockEntry[] = [];
  const add = (kind: UnlockKind, table: Readonly<Record<string, number>>): void => {
    for (const [id, rank] of Object.entries(table)) {
      if (rank > from && rank <= to) out.push({ kind, id, rank });
    }
  };
  add('weapon', WEAPON_UNLOCK);
  add('attachment', ATTACHMENT_UNLOCK);
  add('perk', PERK_UNLOCK);
  add('gadget', GADGET_UNLOCK);
  add('difficulty', DIFFICULTY_UNLOCK);
  return out.sort((a, b) => a.rank - b.rank);
}

// Kills with a weapon to reach each mastery level. Level 0 is below the first entry.
export const MASTERY_KILLS: readonly number[] = [10, 30, 70, 130, 220, 350, 520, 750, 1050, 1400];
export const MAX_MASTERY = MASTERY_KILLS.length;

export interface Mastery {
  level: number;
  kills: number;
  // Kills toward the next level and what it needs. At the top level both are 0.
  into: number;
  needed: number;
  fraction: number;
}

export function masteryFor(kills: number): Mastery {
  const k = Number.isFinite(kills) ? Math.max(0, Math.floor(kills)) : 0;
  let level = 0;
  while (level < MAX_MASTERY && k >= (MASTERY_KILLS[level] ?? Infinity)) level += 1;
  if (level >= MAX_MASTERY) return { level, kills: k, into: 0, needed: 0, fraction: 1 };
  const start = level === 0 ? 0 : (MASTERY_KILLS[level - 1] ?? 0);
  const end = MASTERY_KILLS[level] ?? start + 1;
  return { level, kills: k, into: k - start, needed: end - start, fraction: (k - start) / (end - start) };
}

// Difficulty multiplies the XP of a match.
export const DIFFICULTY_XP: Readonly<Record<DifficultyId, number>> = {
  recruit: 0.8,
  veteran: 1,
  elite: 1.25,
  nightmare: 1.5,
};

export const MEDAL_IDS = [
  'headhunter',
  'marksman',
  'untouchable',
  'streakmaster',
  'demolition',
  'brawler',
  'sectorcontrol',
  'ace',
  'hardened',
] as const;
export type MedalId = (typeof MEDAL_IDS)[number];

export interface MedalDef {
  name: string;
  desc: string;
}

export const MEDALS: Readonly<Record<MedalId, MedalDef>> = {
  headhunter: { name: 'Headhunter', desc: 'Five headshots in one match.' },
  marksman: { name: 'Marksman', desc: '50% accuracy or better over 30 shots.' },
  untouchable: { name: 'Untouchable', desc: 'Win a match without dying.' },
  streakmaster: { name: 'Streak Master', desc: 'A streak of seven kills.' },
  demolition: { name: 'Demolition', desc: 'Four kills with explosives.' },
  brawler: { name: 'Brawler', desc: 'Two knife kills in one match.' },
  sectorcontrol: { name: 'Sector Control', desc: 'Capture every objective.' },
  ace: { name: 'Ace', desc: 'Thirty eliminations in one match.' },
  hardened: { name: 'Hardened', desc: 'Win on Elite or Nightmare.' },
};
