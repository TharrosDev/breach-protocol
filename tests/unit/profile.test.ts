import { describe, it, expect } from 'vitest';
import { createProfile, sanitizeProfile } from '../../src/persist/profile';
import { loadProfile, saveProfile, STORAGE_KEYS } from '../../src/persist/store';

// A minimal in-memory Storage.
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (k) => data.get(k) ?? null,
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => {
      data.delete(k);
    },
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe('profile schema', () => {
  it('garbage becomes an empty profile', () => {
    expect(sanitizeProfile(undefined)).toEqual(createProfile());
    expect(sanitizeProfile('x')).toEqual(createProfile());
    expect(sanitizeProfile([1, 2])).toEqual(createProfile());
  });

  it('a bad field falls back alone and the good ones are kept', () => {
    const p = sanitizeProfile({
      xp: 'lots',
      stats: { matches: 12, wins: 5, kills: -4, headshots: 2.9, bestStreak: 'x' },
      killsBySource: { vx: 30, nonsense: 99, lb: -2 },
      medals: { ace: 3, bogus: 4 },
    });
    expect(p.xp).toBe(0);
    expect(p.stats.matches).toBe(12);
    expect(p.stats.wins).toBe(5);
    expect(p.stats.kills).toBe(0);
    expect(p.stats.headshots).toBe(2);
    expect(p.stats.bestStreak).toBe(0);
    expect(p.killsBySource).toEqual({ vx: 30 });
    expect(p.medals).toEqual({ ace: 3 });
  });

  it('keeps hits at or below shots and wins at or below matches', () => {
    const p = sanitizeProfile({ stats: { shots: 10, hits: 99, matches: 2, wins: 7 } });
    expect(p.stats.hits).toBe(10);
    expect(p.stats.wins).toBe(2);
  });

  it('challenge state needs a real date and pads to three slots', () => {
    expect(sanitizeProfile({ challenges: { day: 'tomorrow', progress: [1] } }).challenges.day).toBe('');
    const c = sanitizeProfile({
      challenges: { day: '2026-10-10', progress: [4, 'x'], done: [true] },
    }).challenges;
    expect(c.progress).toEqual([4, 0, 0]);
    expect(c.done).toEqual([true, false, false]);
  });

  it('XP is a capped whole number', () => {
    expect(sanitizeProfile({ xp: 12.8 }).xp).toBe(12);
    expect(sanitizeProfile({ xp: 1e15 }).xp).toBeLessThan(1e9);
  });
});

describe('profile store', () => {
  it('round-trips under bp_profile', () => {
    const storage = memoryStorage();
    const p = { ...createProfile(), xp: 1234, medals: { ace: 2 } };
    saveProfile(p, storage);
    expect(storage.getItem(STORAGE_KEYS.profile)).not.toBeNull();
    expect(loadProfile(storage)).toEqual(p);
  });

  it('broken JSON loads an empty profile', () => {
    expect(loadProfile(memoryStorage({ bp_profile: '{nope' }))).toEqual(createProfile());
  });

  it('blocked storage neither throws nor loses the game', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadProfile(blocked)).toEqual(createProfile());
    expect(() => {
      saveProfile(createProfile(), blocked);
    }).not.toThrow();
  });
});
