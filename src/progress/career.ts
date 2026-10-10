// Applies a finished match to the profile: XP and rank, lifetime stats, mastery, medals and the daily challenges. Pure:
// it returns the new profile and a report the debrief shows. Nothing here touches storage.
import { PRIMARY_WEAPON_IDS, type PrimaryWeaponId } from '../content/ids';
import {
  DIFFICULTY_XP,
  MAX_XP,
  masteryFor,
  rankFromXp,
  unlocksBetween,
  type MedalId,
  type UnlockEntry,
} from '../content/progression';
import { KILL_SOURCE_IDS, type Profile } from '../persist/profile';
import { advanceChallenges, rollChallenges, type ChallengeResult } from './challenges';
import { earnedMedals } from './medals';
import type { MatchStats } from './tally';

export interface XpLine {
  label: string;
  xp: number;
}

export interface MasteryUp {
  weapon: PrimaryWeaponId;
  level: number;
}

export interface MatchReport {
  lines: XpLine[];
  xp: number;
  rankBefore: number;
  rankAfter: number;
  // Fraction through the rank before and after the match, for the XP bar.
  fractionBefore: number;
  fractionAfter: number;
  maxed: boolean;
  unlocks: UnlockEntry[];
  challenges: ChallengeResult[];
  medals: MedalId[];
  masteryUps: MasteryUp[];
}

// XP for the match itself, before challenge rewards. Each line is shown on the debrief.
export function matchXp(stats: MatchStats): XpLine[] {
  const lines: XpLine[] = [{ label: 'Participation', xp: 25 }];
  lines.push({ label: 'Score', xp: Math.round(stats.score * 0.35) });
  if (stats.win) lines.push({ label: 'Victory', xp: 250 });
  if (stats.zonesCaptured > 0) lines.push({ label: 'Objectives', xp: stats.zonesCaptured * 60 });
  if (stats.headshots > 0) lines.push({ label: 'Headshots', xp: stats.headshots * 8 });
  const minutes = Math.min(stats.seconds, 900) / 60;
  if (minutes >= 1) lines.push({ label: 'Time in match', xp: Math.round(minutes * 10) });
  const subtotal = lines.reduce((n, l) => n + l.xp, 0);
  const bonus = Math.round(subtotal * (DIFFICULTY_XP[stats.difficulty] - 1));
  if (bonus !== 0) lines.push({ label: bonus > 0 ? 'Difficulty bonus' : 'Difficulty adjustment', xp: bonus });
  return lines.filter((l) => l.xp !== 0);
}

export function applyMatch(
  profile: Profile,
  stats: MatchStats,
  day: string,
): { profile: Profile; report: MatchReport } {
  const before = rankFromXp(profile.xp);
  const lines = matchXp(stats);

  const adv = advanceChallenges(profile.challenges, day, stats);
  for (const c of adv.results) {
    if (c.justDone) lines.push({ label: `Challenge: ${c.text}`, xp: c.xp });
  }
  const xp = lines.reduce((n, l) => n + l.xp, 0);
  const totalXp = Math.min(MAX_XP, profile.xp + xp);
  const after = rankFromXp(totalXp);

  const medals = earnedMedals(stats);
  const killsBySource = { ...profile.killsBySource };
  for (const id of KILL_SOURCE_IDS) {
    const n = stats.killsBySource[id] ?? 0;
    if (n > 0) killsBySource[id] = (killsBySource[id] ?? 0) + n;
  }
  const masteryUps: MasteryUp[] = [];
  for (const weapon of PRIMARY_WEAPON_IDS) {
    if ((stats.killsBySource[weapon] ?? 0) <= 0) continue;
    const was = masteryFor(profile.killsBySource[weapon] ?? 0).level;
    const now = masteryFor(killsBySource[weapon] ?? 0).level;
    if (now > was) masteryUps.push({ weapon, level: now });
  }

  const medalCounts = { ...profile.medals };
  for (const m of medals) medalCounts[m] = (medalCounts[m] ?? 0) + 1;

  const s = profile.stats;
  const next: Profile = {
    xp: totalXp,
    stats: {
      matches: s.matches + 1,
      wins: s.wins + (stats.win ? 1 : 0),
      kills: s.kills + stats.kills,
      deaths: s.deaths + stats.deaths,
      headshots: s.headshots + stats.headshots,
      shots: s.shots + stats.shots,
      hits: s.hits + Math.min(stats.hits, stats.shots),
      bestStreak: Math.max(s.bestStreak, stats.bestStreak),
      bestScore: Math.max(s.bestScore, stats.score),
      playSeconds: s.playSeconds + Math.floor(stats.seconds),
      zonesCaptured: s.zonesCaptured + stats.zonesCaptured,
      killstreaksUsed: s.killstreaksUsed + stats.killstreaksUsed,
    },
    killsBySource,
    medals: medalCounts,
    challenges: adv.state,
    challengesCompleted: profile.challengesCompleted + adv.results.filter((c) => c.justDone).length,
  };

  return {
    profile: next,
    report: {
      lines,
      xp,
      rankBefore: before.rank,
      rankAfter: after.rank,
      fractionBefore: before.fraction,
      fractionAfter: after.fraction,
      maxed: after.maxed,
      unlocks: unlocksBetween(before.rank, after.rank),
      challenges: adv.results,
      medals,
      masteryUps,
    },
  };
}

// The profile as the menus read it today: yesterday's challenge progress is cleared.
export function profileForDay(profile: Profile, day: string): Profile {
  const challenges = rollChallenges(profile.challenges, day);
  return challenges === profile.challenges ? profile : { ...profile, challenges };
}
