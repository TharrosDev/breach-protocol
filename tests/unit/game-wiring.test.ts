import { describe, it, expect } from 'vitest';
import { PROFILES, profileFor } from '../../src/render/quality';
import {
  MAX_FX_DT,
  bobSpeed,
  capDt,
  hemiIntensityFor,
  reloadProgress,
  reloadTotal,
  viewmodelVisible,
} from '../../src/app/wiring';

// Pure helpers behind game.ts. game.ts itself needs WebGL, so only these run here.

describe('frame time cap', () => {
  it('clamps to 0.05 s, as legacy does for the viewmodel and effects', () => {
    expect(capDt(0.2)).toBe(MAX_FX_DT);
    expect(MAX_FX_DT).toBe(0.05);
    expect(capDt(0.01)).toBe(0.01);
  });

  it('counts negative and non-finite frame times as zero', () => {
    expect(capDt(-1)).toBe(0);
    expect(capDt(Number.NaN)).toBe(0);
    expect(capDt(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('reload', () => {
  it('applies the 0.7 factor for Fast Hands only', () => {
    expect(reloadTotal(2.1, 'fasthands')).toBeCloseTo(1.47, 10);
    expect(reloadTotal(2.1, 'lightweight')).toBe(2.1);
  });

  it('reports 0 when not reloading and rises to 1 as the reload runs out', () => {
    expect(reloadProgress(0, 2.1)).toBe(0);
    expect(reloadProgress(1.05, 2.1)).toBeCloseTo(0.5, 10);
    expect(reloadProgress(2.1, 2.1)).toBe(0);
    expect(reloadProgress(-0.5, 2.1)).toBe(0);
  });
});

describe('viewmodel visibility', () => {
  it('hides the gun when the player is dead or the DMR is scoped', () => {
    expect(viewmodelVisible(true, false)).toBe(true);
    expect(viewmodelVisible(false, false)).toBe(false);
    expect(viewmodelVisible(true, true)).toBe(false);
  });
});

describe('head bob speed', () => {
  it('is 13 sprinting, 8.5 moving, and 0 standing still (index.html:1778)', () => {
    expect(bobSpeed(true, true)).toBe(13);
    expect(bobSpeed(false, true)).toBe(8.5);
    expect(bobSpeed(false, false)).toBe(0);
  });
});

describe('hemisphere intensity', () => {
  it('is 0.55 with the post chain and 0.9 without it', () => {
    expect(hemiIntensityFor(true)).toBe(0.55);
    expect(hemiIntensityFor(false)).toBe(0.9);
  });
});

describe('quality profiles used by the match', () => {
  it('High gives grass 900 with shadows, post and a pixel ratio capped at 1.5', () => {
    const p = profileFor('high', 3);
    expect(p.grassCount).toBe(900);
    expect(p.shadows).toBe(true);
    expect(p.post).toBe(true);
    expect(p.pixelRatioCap).toBe(1.5);
    expect(p.muzzleLight).toBe(true);
  });

  it('Low gives grass 260 with no shadows, no post and a pixel ratio of 1', () => {
    expect(PROFILES.low.grassCount).toBe(260);
    const p = profileFor('low', 3);
    expect(p.shadows).toBe(false);
    expect(p.post).toBe(false);
    expect(p.pixelRatioCap).toBe(1);
    expect(p.muzzleLight).toBe(false);
    expect(p.rainOnSubstation).toBe(false);
  });
});
