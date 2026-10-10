import { MEDAL_IDS, type MedalId } from '../content/progression';
import type { MatchStats } from './tally';

const EXPLOSIVE_SOURCES = ['frag', 'mine', 'airstrike', 'breach'] as const;

export function explosiveKills(stats: Pick<MatchStats, 'killsBySource'>): number {
  return EXPLOSIVE_SOURCES.reduce((n, id) => n + (stats.killsBySource[id] ?? 0), 0);
}

// The medals a match earned, in the table's order.
export function earnedMedals(stats: MatchStats): MedalId[] {
  const earned = (id: MedalId): boolean => {
    switch (id) {
      case 'headhunter':
        return stats.headshots >= 5;
      case 'marksman':
        return stats.shots >= 30 && stats.hits / stats.shots >= 0.5;
      case 'untouchable':
        return stats.win && stats.deaths === 0;
      case 'streakmaster':
        return stats.bestStreak >= 7;
      case 'demolition':
        return explosiveKills(stats) >= 4;
      case 'brawler':
        return (stats.killsBySource.melee ?? 0) >= 2;
      case 'sectorcontrol':
        return stats.zonesTotal > 0 && stats.zonesCaptured >= stats.zonesTotal;
      case 'ace':
        return stats.kills >= 30;
      case 'hardened':
        return stats.win && (stats.difficulty === 'elite' || stats.difficulty === 'nightmare');
    }
  };
  return MEDAL_IDS.filter(earned);
}
