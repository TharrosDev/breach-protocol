// The persistent player profile: XP, lifetime stats, kills per weapon, medals and today's challenge progress. Like the
// settings it is validated one field at a time, so a damaged or hand-edited value falls back alone and the rest of the
// profile survives.
import { PRIMARY_WEAPON_IDS } from '../content/ids';
import { MAX_XP, MEDAL_IDS } from '../content/progression';

// How many daily challenges a profile tracks.
export const CHALLENGE_SLOTS = 3;

// Where a player kill came from: a weapon id, the knife, or one of the gadget and killstreak sources.
export const KILL_SOURCE_IDS = [
  ...PRIMARY_WEAPON_IDS,
  'vp',
  'melee',
  'frag',
  'mine',
  'sentry',
  'airstrike',
  'breach',
] as const;
export type KillSourceId = (typeof KILL_SOURCE_IDS)[number];

export interface LifetimeStats {
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  headshots: number;
  shots: number;
  hits: number;
  bestStreak: number;
  bestScore: number;
  playSeconds: number;
  zonesCaptured: number;
  killstreaksUsed: number;
}

export const STAT_KEYS = [
  'matches',
  'wins',
  'kills',
  'deaths',
  'headshots',
  'shots',
  'hits',
  'bestStreak',
  'bestScore',
  'playSeconds',
  'zonesCaptured',
  'killstreaksUsed',
] as const satisfies readonly (keyof LifetimeStats)[];

export interface ChallengeState {
  // Local date the challenges were rolled for, as YYYY-MM-DD. Empty before the first roll.
  day: string;
  progress: number[];
  done: boolean[];
}

export interface Profile {
  xp: number;
  stats: LifetimeStats;
  killsBySource: Partial<Record<KillSourceId, number>>;
  medals: Record<string, number>;
  challenges: ChallengeState;
  challengesCompleted: number;
}

const LIMIT = 1_000_000_000;

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : {};
}

function count(value: unknown, max = LIMIT): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(0, Math.floor(value)));
}

export function createProfile(): Profile {
  return {
    xp: 0,
    stats: {
      matches: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      headshots: 0,
      shots: 0,
      hits: 0,
      bestStreak: 0,
      bestScore: 0,
      playSeconds: 0,
      zonesCaptured: 0,
      killstreaksUsed: 0,
    },
    killsBySource: {},
    medals: {},
    challenges: { day: '', progress: [], done: [] },
    challengesCompleted: 0,
  };
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeChallenges(raw: unknown): ChallengeState {
  const r = asRecord(raw);
  const day = typeof r.day === 'string' && DAY_PATTERN.test(r.day) ? r.day : '';
  const progress: number[] = [];
  const done: boolean[] = [];
  const rawProgress: unknown[] = Array.isArray(r.progress) ? r.progress : [];
  const rawDone: unknown[] = Array.isArray(r.done) ? r.done : [];
  for (let i = 0; i < CHALLENGE_SLOTS; i++) {
    progress.push(count(rawProgress[i]) ?? 0);
    done.push(rawDone[i] === true);
  }
  // A stored day with no usable slots is treated as unrolled, so the next match rolls it fresh.
  return day === '' ? { day: '', progress: [], done: [] } : { day, progress, done };
}

export function sanitizeProfile(raw: unknown): Profile {
  const base = createProfile();
  const r = asRecord(raw);
  const s = asRecord(r.stats);
  const stats: LifetimeStats = { ...base.stats };
  for (const key of STAT_KEYS) stats[key] = count(s[key]) ?? base.stats[key];
  // Hits cannot exceed shots, and wins cannot exceed matches.
  stats.hits = Math.min(stats.hits, stats.shots);
  stats.wins = Math.min(stats.wins, stats.matches);

  const killsBySource: Partial<Record<KillSourceId, number>> = {};
  const rawKills = asRecord(r.killsBySource);
  for (const id of KILL_SOURCE_IDS) {
    const n = count(rawKills[id]);
    if (n !== undefined && n > 0) killsBySource[id] = n;
  }

  const medals: Record<string, number> = {};
  const rawMedals = asRecord(r.medals);
  for (const id of MEDAL_IDS) {
    const n = count(rawMedals[id], 100_000);
    if (n !== undefined && n > 0) medals[id] = n;
  }

  return {
    xp: count(r.xp, MAX_XP) ?? 0,
    stats,
    killsBySource,
    medals,
    challenges: sanitizeChallenges(r.challenges),
    challengesCompleted: count(r.challengesCompleted) ?? 0,
  };
}
