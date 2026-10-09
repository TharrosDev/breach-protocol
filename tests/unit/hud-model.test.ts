import { describe, it, expect } from 'vitest';
import type { TokenName } from '../../src/ui/contracts';
import {
  FEED_LIFE_SECONDS,
  FEED_TOKEN,
  HIT_SECONDS,
  HIT_TOKEN,
  ZONE_TOKEN,
  clamp01,
  compassOffset,
  feedFade,
  formatAmmo,
  formatHealth,
  formatTimer,
  gapFromSpread,
  hpFraction,
  isLowHealth,
  killstreakProgress,
  markerSize,
  matchFeed,
  scaleX,
  squadFraction,
  ticketFraction,
  tokenVar,
  wrapAngle,
  zoneBearing,
  type FeedKey,
} from '../../src/ui/hud/layout';
import { worldToMap } from '../../src/ui/hud/minimap';

const PI = Math.PI;

// Every token the HUD can name. Typed against TokenName, so a misspelt name fails to compile.
const ALL_TOKENS: readonly TokenName[] = [
  'hostile',
  'friendly',
  'objective-idle',
  'objective-capturing',
  'objective-contested',
  'objective-captured',
  'health',
  'health-low',
  'hit',
  'kill',
  'warning',
  'good',
  'ink',
  'mute',
  'panel',
];

describe('compassOffset', () => {
  it('centres a bearing that matches the yaw', () => {
    expect(compassOffset(1.2, 1.2)).toEqual({ visible: true, percent: 50 });
  });

  it('puts a bearing 90 degrees to the right at the left edge, and to the left at the right edge', () => {
    const right = compassOffset(PI / 2, 0);
    expect(right.visible).toBe(true);
    expect(right.percent).toBeCloseTo(0, 10);
    const left = compassOffset(-PI / 2, 0);
    expect(left.visible).toBe(true);
    expect(left.percent).toBeCloseTo(100, 10);
  });

  it('hides bearings beyond 90 degrees either side', () => {
    expect(compassOffset(PI, 0).visible).toBe(false);
    expect(compassOffset(PI / 2 + 0.01, 0).visible).toBe(false);
    expect(compassOffset(-PI / 2 - 0.01, 0).visible).toBe(false);
  });

  it('wraps across the 180 degree seam', () => {
    // Facing just short of +PI, a bearing just past -PI is 0.2 rad to the right.
    const o = compassOffset(-PI + 0.1, PI - 0.1);
    expect(o.visible).toBe(true);
    expect(o.percent).toBeCloseTo(50 - (0.2 / (PI / 2)) * 50, 6);
  });

  it('moves linearly across the visible half', () => {
    const quarter = compassOffset(PI / 4, 0);
    expect(quarter.percent).toBeCloseTo(25, 10);
  });
});

describe('wrapAngle and zoneBearing', () => {
  it('wraps into (-PI, PI]', () => {
    // Both ends of the seam are the same direction; atan2 returns -PI for -3 PI, which is in range.
    expect(Math.abs(wrapAngle(3 * PI))).toBeCloseTo(PI, 10);
    expect(Math.abs(wrapAngle(-3 * PI))).toBeCloseTo(PI, 10);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5, 10);
  });

  it('gives the legacy bearing: atan2 of x over z', () => {
    expect(zoneBearing(0, 0, 0, 10)).toBeCloseTo(0, 10);
    expect(zoneBearing(0, 0, 10, 0)).toBeCloseTo(PI / 2, 10);
    expect(zoneBearing(5, 5, 5, -5)).toBeCloseTo(PI, 10);
  });
});

describe('markerSize', () => {
  it('is 900 over the distance, clamped to 18..64', () => {
    expect(markerSize(0)).toBe(64);
    expect(markerSize(14)).toBe(64);
    expect(markerSize(25)).toBe(36);
    expect(markerSize(50)).toBe(18);
    expect(markerSize(1000)).toBe(18);
  });

  it('reads NaN as the smallest size', () => {
    expect(markerSize(Number.NaN)).toBe(18);
  });
});

describe('gapFromSpread', () => {
  it('is 5 px at rest and grows 220 px per unit of spread', () => {
    expect(gapFromSpread(0)).toBe(5);
    expect(gapFromSpread(0.01)).toBeCloseTo(7.2, 10);
    expect(gapFromSpread(0.05)).toBeCloseTo(16, 10);
  });

  it('falls back to 5 px for a non-finite spread', () => {
    expect(gapFromSpread(Number.NaN)).toBe(5);
    expect(gapFromSpread(Number.POSITIVE_INFINITY)).toBe(5);
  });
});

describe('killstreakProgress', () => {
  it('is full when ready', () => {
    expect(killstreakProgress(2, 5, true)).toBe(1);
  });

  it('is full when no further reward exists', () => {
    expect(killstreakProgress(7, null, false)).toBe(1);
  });

  it('is streak over the next reward otherwise', () => {
    expect(killstreakProgress(2, 5, false)).toBeCloseTo(0.4, 10);
    expect(killstreakProgress(0, 5, false)).toBe(0);
  });

  it('clamps to 0..1', () => {
    expect(killstreakProgress(9, 5, false)).toBe(1);
    expect(killstreakProgress(-1, 5, false)).toBe(0);
  });
});

describe('ticketFraction', () => {
  it('is tickets over the start value', () => {
    expect(ticketFraction(75, 150)).toBe(0.5);
    expect(ticketFraction(150, 150)).toBe(1);
  });

  it('clamps and treats a missing start as empty', () => {
    expect(ticketFraction(-5, 150)).toBe(0);
    expect(ticketFraction(200, 150)).toBe(1);
    expect(ticketFraction(10, 0)).toBe(0);
  });
});

describe('formatAmmo', () => {
  it('shows ammo over reserve', () => {
    expect(formatAmmo(12, 60, false)).toBe('12 / 60');
  });

  it('shows RELOADING while reloading', () => {
    expect(formatAmmo(0, 60, true)).toBe('RELOADING');
  });
});

describe('formatTimer and formatHealth', () => {
  it('rounds up to whole seconds', () => {
    expect(formatTimer(2.1)).toBe('3');
    expect(formatTimer(2)).toBe('2');
    expect(formatTimer(0.01)).toBe('1');
  });

  it('never goes below zero', () => {
    expect(formatTimer(0)).toBe('0');
    expect(formatTimer(-1)).toBe('0');
    expect(formatTimer(Number.NaN)).toBe('0');
  });

  it('shows health rounded up, as legacy does', () => {
    expect(formatHealth(64.2)).toBe('65');
    expect(formatHealth(100)).toBe('100');
    expect(formatHealth(-3)).toBe('0');
  });
});

describe('feedFade', () => {
  it('is fully opaque for the first 80% of the life', () => {
    expect(feedFade(0)).toBe(1);
    expect(feedFade(FEED_LIFE_SECONDS * 0.8)).toBe(1);
  });

  it('fades linearly over the last 20% and is gone at 4 s', () => {
    expect(feedFade(3.6)).toBeCloseTo(0.5, 10);
    expect(feedFade(FEED_LIFE_SECONDS)).toBe(0);
    expect(feedFade(10)).toBe(0);
  });

  it('never rises as the line ages', () => {
    let last = 1;
    for (let age = 0; age <= 5; age += 0.05) {
      const o = feedFade(age);
      expect(o).toBeLessThanOrEqual(last + 1e-12);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
      last = o;
    }
  });
});

describe('hpFraction, squadFraction and isLowHealth', () => {
  it('is health over 100, clamped to 0..1', () => {
    expect(hpFraction(100)).toBe(1);
    expect(hpFraction(50)).toBe(0.5);
    expect(hpFraction(150)).toBe(1);
    expect(hpFraction(-10)).toBe(0);
    expect(hpFraction(Number.NaN)).toBe(0);
  });

  it('is squad hp over max hp, clamped', () => {
    expect(squadFraction(30, 60)).toBe(0.5);
    expect(squadFraction(90, 60)).toBe(1);
    expect(squadFraction(10, 0)).toBe(0);
  });

  it('flags health at or under 30%', () => {
    expect(isLowHealth(30)).toBe(true);
    expect(isLowHealth(31)).toBe(false);
  });
});

describe('small helpers', () => {
  it('clamp01 reads NaN as 0', () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-2)).toBe(0);
  });

  it('scaleX writes three decimals', () => {
    expect(scaleX(0.5)).toBe('scaleX(0.500)');
    expect(scaleX(2)).toBe('scaleX(1.000)');
  });

  it('tokenVar wraps a token name', () => {
    expect(tokenVar('hit')).toBe('var(--tok-hit)');
  });

  it('worldToMap maps -60..60 onto 0..180 like legacy mmX', () => {
    expect(worldToMap(-60)).toBe(0);
    expect(worldToMap(0)).toBe(90);
    expect(worldToMap(60)).toBe(180);
  });
});

describe('matchFeed', () => {
  const a: FeedKey = { text: 'A', cls: 'kill' };
  const b: FeedKey = { text: 'B', cls: '' };
  const c: FeedKey = { text: 'C', cls: 'warn' };
  const x: FeedKey = { text: 'X', cls: 'good' };

  it('marks every entry new when there was no previous feed', () => {
    expect(matchFeed([], [a, b])).toEqual([-1, -1]);
  });

  it('keeps an unchanged list in place', () => {
    expect(matchFeed([a, b, c], [a, b, c])).toEqual([0, 1, 2]);
  });

  it('finds a prepended entry as new and keeps the old ones', () => {
    expect(matchFeed([b, c], [x, b, c])).toEqual([-1, 0, 1]);
  });

  it('keeps indices when the sim trims the tail', () => {
    expect(matchFeed([a, b, c], [a, b])).toEqual([0, 1]);
  });

  it('treats a list with no overlap as all new', () => {
    expect(matchFeed([a], [x, c])).toEqual([-1, -1]);
  });

  it('matches on the class as well as the text', () => {
    expect(matchFeed([a], [{ text: 'A', cls: '' }])).toEqual([-1]);
  });

  it('returns nothing for an empty list', () => {
    expect(matchFeed([a], [])).toEqual([]);
  });
});

describe('token mappings', () => {
  it('maps every zone status, hit kind and feed class to a real token', () => {
    const names = new Set<string>(ALL_TOKENS);
    for (const t of Object.values(ZONE_TOKEN)) expect(names.has(t)).toBe(true);
    for (const t of Object.values(HIT_TOKEN)) expect(names.has(t)).toBe(true);
    for (const t of Object.values(FEED_TOKEN)) expect(names.has(t)).toBe(true);
  });

  it('gives every hit kind a timer', () => {
    expect(HIT_SECONDS.hit).toBeGreaterThan(0);
    expect(HIT_SECONDS.kill).toBeGreaterThan(HIT_SECONDS.hit);
    expect(HIT_SECONDS.head).toBe(HIT_SECONDS.kill);
  });
});
