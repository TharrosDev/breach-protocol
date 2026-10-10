import { describe, it, expect } from 'vitest';
import { MAX_RANK, MAX_XP, rankFromXp, xpAtRank } from '../../src/content/progression';
import { createProfile, CHALLENGE_SLOTS } from '../../src/persist/profile';
import {
  advanceChallenges,
  dailyChallenges,
  dayKey,
  metricValue,
  rollChallenges,
} from '../../src/progress/challenges';
import { applyMatch, matchXp, profileForDay } from '../../src/progress/career';
import { earnedMedals } from '../../src/progress/medals';
import { MatchTally, buildMatchStats, type MatchStats } from '../../src/progress/tally';

const DAY = '2026-10-10';

function stats(over: Partial<MatchStats> = {}): MatchStats {
  return {
    win: false,
    score: 1000,
    kills: 10,
    deaths: 2,
    seconds: 300,
    shots: 100,
    hits: 40,
    headshots: 3,
    bestStreak: 4,
    zonesCaptured: 1,
    zonesTotal: 3,
    killstreaksUsed: 1,
    killsBySource: { vx: 8, melee: 2 },
    difficulty: 'veteran',
    weapon: 'vx',
    ...over,
  };
}

describe('daily challenges', () => {
  it('are the same for the same date and differ across dates', () => {
    expect(dailyChallenges(DAY)).toEqual(dailyChallenges(DAY));
    const other = Array.from({ length: 12 }, (_, i) =>
      dailyChallenges(`2026-11-${String(i + 1).padStart(2, '0')}`),
    );
    expect(other.some((c) => JSON.stringify(c) !== JSON.stringify(dailyChallenges(DAY)))).toBe(true);
  });

  it('are three distinct kinds with a target and a reward', () => {
    const list = dailyChallenges(DAY);
    expect(list).toHaveLength(CHALLENGE_SLOTS);
    expect(new Set(list.map((c) => c.metric)).size).toBe(CHALLENGE_SLOTS);
    for (const c of list) {
      expect(c.target).toBeGreaterThan(0);
      expect(c.xp).toBeGreaterThan(0);
    }
  });

  it('dayKey is the local date as YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('keep progress within a day and reset on a new one', () => {
    const state = { day: DAY, progress: [3, 2, 1], done: [false, false, true] };
    expect(rollChallenges(state, DAY)).toBe(state);
    const next = rollChallenges(state, '2026-10-11');
    expect(next.day).toBe('2026-10-11');
    expect(next.progress).toEqual([0, 0, 0]);
    expect(next.done).toEqual([false, false, false]);
  });

  it('add up over matches, finish once, and pay once', () => {
    const list = dailyChallenges(DAY);
    const first = list[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    // A match that satisfies the first challenge on its own.
    const big = stats({
      kills: 999,
      headshots: 999,
      zonesCaptured: 99,
      bestStreak: 99,
      killstreaksUsed: 99,
      win: true,
      shots: 100,
      hits: 100,
      killsBySource: { melee: 99, frag: 99 },
    });
    expect(metricValue(first.metric, big)).toBeGreaterThanOrEqual(first.target);
    const a = advanceChallenges({ day: '', progress: [], done: [] }, DAY, big);
    expect(a.results[0]).toMatchObject({ done: true, justDone: true, progress: first.target });
    const b = advanceChallenges(a.state, DAY, big);
    expect(b.results[0]).toMatchObject({ done: true, justDone: false });
  });

  it('a max challenge keeps the best value and a sum adds', () => {
    expect(metricValue('streak', stats({ bestStreak: 6 }))).toBe(6);
    expect(metricValue('matches', stats())).toBe(1);
    // Accuracy only counts over 20 or more shots.
    expect(metricValue('accuracy', stats({ shots: 10, hits: 10 }))).toBe(0);
    expect(metricValue('accuracy', stats({ shots: 50, hits: 25 }))).toBe(50);
  });
});

describe('medals', () => {
  it('a quiet match earns none', () => {
    expect(earnedMedals(stats({ headshots: 0, bestStreak: 1, kills: 3, killsBySource: {} }))).toEqual([]);
  });

  it('awards each medal at its threshold', () => {
    const medals = earnedMedals(
      stats({
        headshots: 5,
        shots: 40,
        hits: 20,
        win: true,
        deaths: 0,
        bestStreak: 7,
        killsBySource: { frag: 2, mine: 2, melee: 2 },
        zonesCaptured: 3,
        zonesTotal: 3,
        kills: 30,
        difficulty: 'elite',
      }),
    );
    expect(medals).toEqual([
      'headhunter',
      'marksman',
      'untouchable',
      'streakmaster',
      'demolition',
      'brawler',
      'sectorcontrol',
      'ace',
      'hardened',
    ]);
  });

  it('marksman needs 30 shots, and untouchable needs a win', () => {
    expect(earnedMedals(stats({ shots: 20, hits: 20 }))).not.toContain('marksman');
    expect(earnedMedals(stats({ win: false, deaths: 0 }))).not.toContain('untouchable');
  });
});

describe('match XP', () => {
  it('a win pays more than a loss, and Nightmare pays more than Recruit', () => {
    const sum = (s: MatchStats): number => matchXp(s).reduce((n, l) => n + l.xp, 0);
    expect(sum(stats({ win: true }))).toBeGreaterThan(sum(stats({ win: false })));
    expect(sum(stats({ difficulty: 'nightmare' }))).toBeGreaterThan(sum(stats({ difficulty: 'recruit' })));
  });

  it('every match pays at least the participation XP', () => {
    const lines = matchXp(stats({ score: 0, kills: 0, headshots: 0, zonesCaptured: 0, seconds: 5 }));
    expect(lines.reduce((n, l) => n + l.xp, 0)).toBeGreaterThanOrEqual(25 * 0.8);
  });
});

describe('applyMatch', () => {
  it('updates the lifetime stats', () => {
    const { profile } = applyMatch(createProfile(), stats({ win: true }), DAY);
    expect(profile.stats).toMatchObject({
      matches: 1,
      wins: 1,
      kills: 10,
      deaths: 2,
      headshots: 3,
      shots: 100,
      hits: 40,
      bestStreak: 4,
      bestScore: 1000,
      playSeconds: 300,
      zonesCaptured: 1,
      killstreaksUsed: 1,
    });
    expect(profile.killsBySource).toMatchObject({ vx: 8, melee: 2 });
    expect(profile.xp).toBeGreaterThan(0);
  });

  it('best values only go up', () => {
    const base = applyMatch(createProfile(), stats({ score: 5000, bestStreak: 9 }), DAY).profile;
    const next = applyMatch(base, stats({ score: 100, bestStreak: 1 }), DAY).profile;
    expect(next.stats.bestScore).toBe(5000);
    expect(next.stats.bestStreak).toBe(9);
    expect(next.stats.matches).toBe(2);
  });

  it('reports a rank-up with the unlocks it opened', () => {
    // Start 10 XP short of rank 3, which opens the Breaker and Fast Hands.
    const profile = { ...createProfile(), xp: xpAtRank(3) - 10 };
    const { report, profile: after } = applyMatch(profile, stats(), DAY);
    expect(report.rankBefore).toBe(2);
    expect(report.rankAfter).toBeGreaterThanOrEqual(3);
    expect(report.unlocks.some((u) => u.kind === 'weapon' && u.id === 'bk')).toBe(true);
    expect(rankFromXp(after.xp).rank).toBe(report.rankAfter);
  });

  it('reports challenge progress and pays a completed one into the XP', () => {
    const first = dailyChallenges(DAY)[0];
    if (first === undefined) throw new Error('no challenge');
    const big = stats({
      kills: 999,
      headshots: 999,
      zonesCaptured: 99,
      bestStreak: 99,
      killstreaksUsed: 99,
      win: true,
      shots: 100,
      hits: 100,
      killsBySource: { melee: 99, frag: 99 },
    });
    const { report } = applyMatch(createProfile(), big, DAY);
    expect(report.challenges).toHaveLength(CHALLENGE_SLOTS);
    expect(report.challenges.some((c) => c.justDone)).toBe(true);
    expect(report.lines.some((l) => l.label.startsWith('Challenge:'))).toBe(true);
    expect(report.xp).toBe(report.lines.reduce((n, l) => n + l.xp, 0));
  });

  it('reports a mastery level gained with a weapon', () => {
    const profile = { ...createProfile(), killsBySource: { vx: 8 } };
    const { report } = applyMatch(profile, stats({ killsBySource: { vx: 5 } }), DAY);
    expect(report.masteryUps).toEqual([{ weapon: 'vx', level: 1 }]);
  });

  it('XP stops at the top rank', () => {
    const profile = { ...createProfile(), xp: MAX_XP - 5 };
    const { profile: after, report } = applyMatch(profile, stats({ win: true }), DAY);
    expect(after.xp).toBe(MAX_XP);
    expect(report.rankAfter).toBe(MAX_RANK);
    expect(report.maxed).toBe(true);
  });

  it('profileForDay clears yesterday', () => {
    const p = applyMatch(createProfile(), stats(), DAY).profile;
    const nextDay = profileForDay(p, '2026-10-11');
    expect(nextDay.challenges.day).toBe('2026-10-11');
    expect(nextDay.challenges.progress).toEqual([0, 0, 0]);
    expect(nextDay.xp).toBe(p.xp);
    expect(profileForDay(p, DAY)).toBe(p);
  });
});

describe('match tally', () => {
  it('counts kills by source, headshots and the best streak', () => {
    const t = new MatchTally();
    t.kill('vx', false);
    t.kill('vx', true);
    t.kill('frag', false);
    t.died();
    t.kill('melee', false);
    t.kill('unknown-source', false);
    expect(t.killsBySource).toEqual({ vx: 2, frag: 1, melee: 1 });
    expect(t.headshots).toBe(1);
    expect(t.bestStreak).toBe(3);
  });

  it('builds the stats for the profile from a result', () => {
    const t = new MatchTally();
    t.kill('lb', true);
    t.killstreakUsed();
    const s = buildMatchStats(
      {
        win: true,
        score: 300,
        kills: 1,
        deaths: 0,
        seconds: 80,
        shots: 4,
        hits: 9,
        zones: [{ captured: true }, { captured: false }],
      },
      t,
      'elite',
      'lb',
    );
    expect(s).toMatchObject({
      win: true,
      headshots: 1,
      killstreaksUsed: 1,
      zonesCaptured: 1,
      zonesTotal: 2,
      hits: 4,
      difficulty: 'elite',
      weapon: 'lb',
      killsBySource: { lb: 1 },
    });
  });
});
