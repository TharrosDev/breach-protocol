// Daily challenges. The three of a day come from the date alone, so every launch that day shows the same ones, and no
// server is needed. Progress is stored in the profile and resets when the date changes.
import { createRng } from '../core/rng';
import { CHALLENGE_SLOTS, type ChallengeState } from '../persist/profile';
import { explosiveKills } from './medals';
import type { MatchStats } from './tally';

export type Metric =
  | 'kills'
  | 'headshots'
  | 'wins'
  | 'zones'
  | 'streak'
  | 'melee'
  | 'explosive'
  | 'killstreaks'
  | 'matches'
  | 'accuracy';

interface Template {
  id: Metric;
  // 'sum' adds the match value to the progress. 'max' keeps the best value seen that day.
  mode: 'sum' | 'max';
  text: (n: number) => string;
  targets: readonly number[];
  xp: readonly number[];
}

const TEMPLATES: readonly Template[] = [
  {
    id: 'kills',
    mode: 'sum',
    text: (n) => `Eliminate ${String(n)} hostiles`,
    targets: [15, 25, 40],
    xp: [200, 300, 450],
  },
  {
    id: 'headshots',
    mode: 'sum',
    text: (n) => `Land ${String(n)} headshot kills`,
    targets: [5, 10, 18],
    xp: [200, 320, 500],
  },
  {
    id: 'wins',
    mode: 'sum',
    text: (n) => (n === 1 ? 'Win a match' : `Win ${String(n)} matches`),
    targets: [1, 2],
    xp: [300, 550],
  },
  {
    id: 'zones',
    mode: 'sum',
    text: (n) => `Capture ${String(n)} objectives`,
    targets: [3, 6],
    xp: [200, 380],
  },
  {
    id: 'streak',
    mode: 'max',
    text: (n) => `Reach a ${String(n)} kill streak`,
    targets: [4, 6, 8],
    xp: [200, 320, 480],
  },
  {
    id: 'melee',
    mode: 'sum',
    text: (n) => `Get ${String(n)} knife kills`,
    targets: [2, 4],
    xp: [250, 420],
  },
  {
    id: 'explosive',
    mode: 'sum',
    text: (n) => `Get ${String(n)} kills with explosives`,
    targets: [3, 6],
    xp: [220, 400],
  },
  {
    id: 'killstreaks',
    mode: 'sum',
    text: (n) => (n === 1 ? 'Call in a killstreak' : `Call in ${String(n)} killstreaks`),
    targets: [1, 2, 3],
    xp: [150, 260, 380],
  },
  {
    id: 'matches',
    mode: 'sum',
    text: (n) => `Play ${String(n)} matches`,
    targets: [2, 3],
    xp: [150, 250],
  },
  {
    id: 'accuracy',
    mode: 'max',
    text: (n) => `Finish a match with ${String(n)}% accuracy`,
    targets: [35, 45, 55],
    xp: [200, 320, 480],
  },
];

export interface Challenge {
  metric: Metric;
  mode: 'sum' | 'max';
  text: string;
  target: number;
  xp: number;
}

// Local date as YYYY-MM-DD.
export function dayKey(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function seedOf(day: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// The challenges for a day: three distinct kinds, each with a seeded target.
export function dailyChallenges(day: string): Challenge[] {
  const rng = createRng(seedOf(day));
  const pool = [...TEMPLATES];
  const out: Challenge[] = [];
  for (let i = 0; i < CHALLENGE_SLOTS && pool.length > 0; i++) {
    const t = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    if (t === undefined) break;
    const tier = Math.floor(rng.next() * t.targets.length);
    const target = t.targets[tier] ?? t.targets[0] ?? 1;
    out.push({ metric: t.id, mode: t.mode, text: t.text(target), target, xp: t.xp[tier] ?? t.xp[0] ?? 100 });
  }
  return out;
}

// Rolls the stored state to `day`: the same day keeps its progress, a new day starts clean.
export function rollChallenges(state: ChallengeState, day: string): ChallengeState {
  if (state.day === day && state.progress.length === CHALLENGE_SLOTS) return state;
  return {
    day,
    progress: Array.from({ length: CHALLENGE_SLOTS }, () => 0),
    done: Array.from({ length: CHALLENGE_SLOTS }, () => false),
  };
}

// What one match adds to a metric.
export function metricValue(metric: Metric, stats: MatchStats): number {
  switch (metric) {
    case 'kills':
      return stats.kills;
    case 'headshots':
      return stats.headshots;
    case 'wins':
      return stats.win ? 1 : 0;
    case 'zones':
      return stats.zonesCaptured;
    case 'streak':
      return stats.bestStreak;
    case 'melee':
      return stats.killsBySource.melee ?? 0;
    case 'explosive':
      return explosiveKills(stats);
    case 'killstreaks':
      return stats.killstreaksUsed;
    case 'matches':
      return 1;
    case 'accuracy':
      return stats.shots >= 20 ? Math.round((100 * stats.hits) / stats.shots) : 0;
  }
}

export interface ChallengeResult {
  text: string;
  target: number;
  progress: number;
  xp: number;
  done: boolean;
  // Completed by this match.
  justDone: boolean;
}

// Applies one match to the day's challenges. Returns the new state and one result per challenge. A challenge that
// was already done keeps its progress and pays nothing again.
export function advanceChallenges(
  state: ChallengeState,
  day: string,
  stats: MatchStats,
): { state: ChallengeState; results: ChallengeResult[] } {
  const rolled = rollChallenges(state, day);
  const list = dailyChallenges(day);
  const progress = [...rolled.progress];
  const done = [...rolled.done];
  const results = list.map((c, i): ChallengeResult => {
    const before = progress[i] ?? 0;
    const wasDone = done[i] === true;
    const value = metricValue(c.metric, stats);
    const raw = c.mode === 'sum' ? before + value : Math.max(before, value);
    const next = Math.min(c.target, raw);
    progress[i] = next;
    const nowDone = next >= c.target;
    done[i] = nowDone;
    return {
      text: c.text,
      target: c.target,
      progress: next,
      xp: c.xp,
      done: nowDone,
      justDone: nowDone && !wasDone,
    };
  });
  return { state: { day, progress, done }, results };
}
