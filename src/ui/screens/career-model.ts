// Pure helpers for the screens that show the profile: the menu's rank card, the Career screen and the debrief. No DOM.
import { GADGETS } from '../../content/gadgets';
import type { GadgetId, PrimaryWeaponId } from '../../content/ids';
import { DIFF } from '../../content/difficulty';
import {
  MAX_MASTERY,
  MEDALS,
  MEDAL_IDS,
  masteryFor,
  rankFromXp,
  rankTitle,
  unlockRank,
  unlocksBetween,
  type MedalId,
  type RankInfo,
  type UnlockEntry,
  type UnlockKind,
  MAX_RANK,
} from '../../content/progression';
import { PRIMARY_WEAPON_IDS } from '../../content/ids';
import { WEAPONS } from '../../content/weapons';
import type { Profile } from '../../persist/profile';
import { CHALLENGE_SLOTS } from '../../persist/profile';
import { dailyChallenges } from '../../progress/challenges';
import { ATTACHMENT_INFO, PERK_INFO, type TileText } from './model';

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

// 3725 seconds -> '1 h 2 min'. Under an hour it is minutes only.
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${String(hours)} h ${String(minutes)} min`;
  return `${String(minutes)} min`;
}

export function percent(part: number, whole: number): string {
  return whole > 0 ? `${String(Math.round((100 * part) / whole))}%` : '–';
}

export interface RankView {
  rank: number;
  title: string;
  info: RankInfo;
  // 'Rank 7 · Sergeant'
  heading: string;
  // '320 / 740 XP', or 'Max rank' at the top.
  xpText: string;
}

export function rankView(xp: number): RankView {
  const info = rankFromXp(xp);
  const title = rankTitle(info.rank);
  return {
    rank: info.rank,
    title,
    info,
    heading: `Rank ${String(info.rank)} · ${title}`,
    xpText: info.maxed ? 'Max rank' : `${formatInt(info.into)} / ${formatInt(info.needed)} XP`,
  };
}

export function unlockLabel(entry: { kind: UnlockKind; id: string }): string {
  switch (entry.kind) {
    case 'weapon':
      return WEAPONS[entry.id as PrimaryWeaponId].name;
    case 'attachment':
      return ATTACHMENT_INFO[entry.id as keyof typeof ATTACHMENT_INFO].name;
    case 'perk':
      return PERK_INFO[entry.id as keyof typeof PERK_INFO].name;
    case 'gadget':
      return GADGETS[entry.id as GadgetId].name;
    case 'difficulty':
      return `${DIFF[entry.id as keyof typeof DIFF].name} difficulty`;
  }
}

const KIND_NAME: Readonly<Record<UnlockKind, string>> = {
  weapon: 'Weapon',
  attachment: 'Attachment',
  perk: 'Perk',
  gadget: 'Gadget',
  difficulty: 'Difficulty',
};

export function unlockTile(entry: UnlockEntry): TileText {
  return { title: unlockLabel(entry), sub: `${KIND_NAME[entry.kind]} · rank ${String(entry.rank)}` };
}

// The next unlocks above the player's rank, nearest first.
export function nextUnlocks(rank: number, count = 6): UnlockEntry[] {
  if (rank >= MAX_RANK) return [];
  return unlocksBetween(rank, MAX_RANK).slice(0, count);
}

export function lockText(kind: UnlockKind, id: string): string {
  return `Unlocks at rank ${String(unlockRank(kind, id))}`;
}

export function careerTiles(p: Profile): TileText[] {
  const s = p.stats;
  const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : s.kills > 0 ? s.kills.toFixed(2) : '–';
  return [
    { title: formatInt(s.matches), sub: 'Matches played' },
    { title: percent(s.wins, s.matches), sub: `Win rate (${formatInt(s.wins)} wins)` },
    { title: formatInt(s.kills), sub: `Eliminations (K/D ${kd})` },
    { title: formatInt(s.deaths), sub: 'Deaths' },
    { title: formatInt(s.headshots), sub: `Headshot kills (${percent(s.headshots, s.kills)})` },
    { title: percent(s.hits, s.shots), sub: 'Accuracy' },
    { title: formatInt(s.bestStreak), sub: 'Best streak' },
    { title: formatInt(s.bestScore), sub: 'Best score' },
    { title: formatDuration(s.playSeconds), sub: 'Time played' },
    { title: formatInt(s.zonesCaptured), sub: 'Objectives captured' },
  ];
}

export interface MasteryRow {
  id: PrimaryWeaponId;
  name: string;
  level: number;
  kills: number;
  fraction: number;
  // 'Level 3 · 52 kills', or 'Mastered · 1,400 kills'.
  text: string;
}

export function masteryRows(p: Profile): MasteryRow[] {
  return PRIMARY_WEAPON_IDS.map((id) => {
    const m = masteryFor(p.killsBySource[id] ?? 0);
    const maxed = m.level >= MAX_MASTERY;
    return {
      id,
      name: WEAPONS[id].name,
      level: m.level,
      kills: m.kills,
      fraction: m.fraction,
      text: `${maxed ? 'Mastered' : `Level ${String(m.level)}`} · ${formatInt(m.kills)} ${m.kills === 1 ? 'kill' : 'kills'}`,
    };
  });
}

export interface ChallengeRow {
  text: string;
  progress: number;
  target: number;
  fraction: number;
  xp: number;
  done: boolean;
}

// Today's challenges with the stored progress. A profile saved on another day shows zero progress.
export function challengeRows(p: Profile, day: string): ChallengeRow[] {
  const same = p.challenges.day === day;
  return dailyChallenges(day)
    .slice(0, CHALLENGE_SLOTS)
    .map((c, i) => {
      const progress = same ? Math.min(c.target, p.challenges.progress[i] ?? 0) : 0;
      return {
        text: c.text,
        progress,
        target: c.target,
        fraction: progress / c.target,
        xp: c.xp,
        done: same && p.challenges.done[i] === true,
      };
    });
}

export interface MedalRow {
  id: MedalId;
  name: string;
  desc: string;
  count: number;
}

export function medalRows(p: Profile): MedalRow[] {
  return MEDAL_IDS.map((id) => ({
    id,
    name: MEDALS[id].name,
    desc: MEDALS[id].desc,
    count: p.medals[id] ?? 0,
  }));
}
