import { describe, it, expect } from 'vitest';
import {
  ATTACHMENT_IDS,
  DIFFICULTY_IDS,
  GADGET_IDS,
  PERK_IDS,
  PRIMARY_WEAPON_IDS,
} from '../../src/content/ids';
import {
  MASTERY_KILLS,
  MAX_MASTERY,
  MAX_RANK,
  MAX_XP,
  isUnlocked,
  masteryFor,
  rankFromXp,
  rankTitle,
  unlocksBetween,
  xpAtRank,
  xpToNext,
} from '../../src/content/progression';
import { DEFAULT_LOADOUT } from '../../src/persist/schema';
import { enforceUnlocks, loadoutLocks } from '../../src/progress/unlocks';

describe('ranks', () => {
  it('rank 1 starts at 0 XP and each rank costs more than the last', () => {
    expect(xpAtRank(1)).toBe(0);
    for (let r = 1; r < MAX_RANK; r++) expect(xpToNext(r + 1)).toBeGreaterThan(xpToNext(r));
    expect(xpAtRank(2)).toBe(xpToNext(1));
    expect(MAX_XP).toBe(xpAtRank(MAX_RANK));
  });

  it('rankFromXp is exact at each boundary', () => {
    for (let r = 1; r < MAX_RANK; r++) {
      expect(rankFromXp(xpAtRank(r)).rank).toBe(r);
      expect(rankFromXp(xpAtRank(r + 1) - 1).rank).toBe(r);
    }
    const mid = rankFromXp(xpAtRank(4) + xpToNext(4) / 2);
    expect(mid.rank).toBe(4);
    expect(mid.fraction).toBeCloseTo(0.5, 2);
  });

  it('the top rank is capped and shows a full bar', () => {
    const top = rankFromXp(MAX_XP * 5);
    expect(top).toMatchObject({ rank: MAX_RANK, maxed: true, fraction: 1 });
  });

  it('bad XP values read as rank 1', () => {
    expect(rankFromXp(Number.NaN).rank).toBe(1);
    expect(rankFromXp(-40).rank).toBe(1);
  });

  it('titles change every three ranks and stop at the last one', () => {
    expect(rankTitle(1)).toBe(rankTitle(3));
    expect(rankTitle(4)).not.toBe(rankTitle(3));
    expect(rankTitle(MAX_RANK)).toBe('Legend');
  });
});

describe('unlocks', () => {
  it('the default loadout is available at rank 1', () => {
    expect(loadoutLocks(DEFAULT_LOADOUT, 1)).toEqual([]);
  });

  it('every item opens by the top rank, and something is locked at rank 1', () => {
    const items: [Parameters<typeof isUnlocked>[0], readonly string[]][] = [
      ['weapon', PRIMARY_WEAPON_IDS],
      ['attachment', ATTACHMENT_IDS],
      ['perk', PERK_IDS],
      ['gadget', GADGET_IDS],
      ['difficulty', DIFFICULTY_IDS],
    ];
    for (const [kind, ids] of items) {
      expect(ids.every((id) => isUnlocked(kind, id, MAX_RANK))).toBe(true);
      expect(ids.some((id) => !isUnlocked(kind, id, 1))).toBe(true);
    }
  });

  it('unlocksBetween lists the items of the ranks passed, in rank order', () => {
    const list = unlocksBetween(2, 4);
    expect(list.every((u) => u.rank > 2 && u.rank <= 4)).toBe(true);
    expect(list.map((u) => u.rank)).toEqual([...list.map((u) => u.rank)].sort((a, b) => a - b));
    expect(list.some((u) => u.kind === 'weapon' && u.id === 'bk')).toBe(true);
    expect(unlocksBetween(5, 5)).toEqual([]);
  });

  it('enforceUnlocks puts locked picks back to the defaults and keeps two different gadgets', () => {
    const wanted = {
      ...DEFAULT_LOADOUT,
      primary: 'lb' as const,
      attachment: 'hollow' as const,
      perk: 'adrenaline' as const,
      gadgets: ['stim', 'claymore'] as [never, never],
      difficulty: 'nightmare' as const,
    };
    const fixed = enforceUnlocks(wanted, 1);
    expect(fixed.primary).toBe(DEFAULT_LOADOUT.primary);
    expect(fixed.attachment).toBe(DEFAULT_LOADOUT.attachment);
    expect(fixed.perk).toBe(DEFAULT_LOADOUT.perk);
    expect(fixed.difficulty).toBe(DEFAULT_LOADOUT.difficulty);
    expect(new Set(fixed.gadgets).size).toBe(2);
    expect(loadoutLocks(fixed, 1)).toEqual([]);
    // Nothing changes once the rank has unlocked it all.
    expect(enforceUnlocks(wanted, MAX_RANK)).toEqual(wanted);
  });
});

describe('weapon mastery', () => {
  it('starts at level 0 and rises at each threshold', () => {
    expect(masteryFor(0).level).toBe(0);
    MASTERY_KILLS.forEach((need, i) => {
      expect(masteryFor(need - 1).level).toBe(i);
      expect(masteryFor(need).level).toBe(i + 1);
    });
  });

  it('is full at the top level', () => {
    const top = masteryFor(1_000_000);
    expect(top.level).toBe(MAX_MASTERY);
    expect(top.fraction).toBe(1);
  });

  it('reports progress inside a level', () => {
    const m = masteryFor(20);
    expect(m.level).toBe(1);
    expect(m.into).toBe(10);
    expect(m.needed).toBe(20);
    expect(m.fraction).toBeCloseTo(0.5, 5);
  });
});
