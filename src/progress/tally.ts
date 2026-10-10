// Per-match counters the sim result does not carry: headshots, the best streak, kills by source and killstreaks used.
// The match feeds it the sim's events and reads it when the match ends. No DOM and no sim imports.
import type { DifficultyId, PrimaryWeaponId } from '../content/ids';
import { KILL_SOURCE_IDS, type KillSourceId } from '../persist/profile';

export interface MatchStats {
  win: boolean;
  score: number;
  kills: number;
  deaths: number;
  seconds: number;
  shots: number;
  hits: number;
  headshots: number;
  bestStreak: number;
  zonesCaptured: number;
  zonesTotal: number;
  killstreaksUsed: number;
  killsBySource: Partial<Record<KillSourceId, number>>;
  difficulty: DifficultyId;
  weapon: PrimaryWeaponId;
}

export function asKillSource(value: string): KillSourceId | null {
  return (KILL_SOURCE_IDS as readonly string[]).includes(value) ? (value as KillSourceId) : null;
}

export class MatchTally {
  headshots = 0;
  bestStreak = 0;
  killstreaksUsed = 0;
  readonly killsBySource: Partial<Record<KillSourceId, number>> = {};

  // The running streak, kept here so a death inside the same sim step cannot hide the best one.
  private run = 0;

  // A player kill. `source` is the sim's kill source (a weapon id or a gadget).
  kill(source: string, head: boolean): void {
    const id = asKillSource(source);
    if (id !== null) this.killsBySource[id] = (this.killsBySource[id] ?? 0) + 1;
    if (head) this.headshots += 1;
    this.run += 1;
    this.bestStreak = Math.max(this.bestStreak, this.run);
  }

  // The player was eliminated: the streak starts again.
  died(): void {
    this.run = 0;
  }

  killstreakUsed(): void {
    this.killstreaksUsed += 1;
  }
}

// The parts of the match result the stats need. The sim's MatchResult satisfies it.
export interface ResultLike {
  win: boolean;
  score: number;
  kills: number;
  deaths: number;
  seconds: number;
  shots: number;
  hits: number;
  zones: readonly { captured: boolean }[];
}

export function buildMatchStats(
  result: ResultLike,
  tally: MatchTally,
  difficulty: DifficultyId,
  weapon: PrimaryWeaponId,
): MatchStats {
  return {
    win: result.win,
    score: result.score,
    kills: result.kills,
    deaths: result.deaths,
    seconds: result.seconds,
    shots: result.shots,
    hits: Math.min(result.hits, result.shots),
    headshots: tally.headshots,
    // A streak still running at the end is already counted by the tally.
    bestStreak: tally.bestStreak,
    zonesCaptured: result.zones.filter((z) => z.captured).length,
    zonesTotal: result.zones.length,
    killstreaksUsed: tally.killstreaksUsed,
    killsBySource: { ...tally.killsBySource },
    difficulty,
    weapon,
  };
}
