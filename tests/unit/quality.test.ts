import { describe, it, expect } from 'vitest';
import { PROFILES, profileFor } from '../../src/render/quality';

describe('quality profiles', () => {
  it('High matches the legacy values', () => {
    expect(PROFILES.high).toEqual({
      shadows: true,
      pixelRatioCap: 2,
      post: true,
      hemiIntensity: 0.55,
      grassCount: 900,
      lampCount: 6,
      rainOnSubstation: true,
      muzzleLight: true,
    });
  });

  it('Low matches the legacy values', () => {
    expect(PROFILES.low).toEqual({
      shadows: false,
      pixelRatioCap: 1,
      post: false,
      hemiIntensity: 0.9,
      grassCount: 260,
      lampCount: 6,
      rainOnSubstation: false,
      muzzleLight: false,
    });
  });

  it('caps the pixel ratio at 2 on High', () => {
    expect(profileFor('high', 3).pixelRatioCap).toBe(2);
    expect(profileFor('high', 1.5).pixelRatioCap).toBe(1.5);
    expect(profileFor('high', 1).pixelRatioCap).toBe(1);
  });

  it('uses a pixel ratio of 1 on Low whatever the device ratio', () => {
    expect(profileFor('low', 3).pixelRatioCap).toBe(1);
    expect(profileFor('low', 1.5).pixelRatioCap).toBe(1);
  });

  it('keeps the other fields of the tier', () => {
    expect(profileFor('high', 2)).toEqual({ ...PROFILES.high, pixelRatioCap: 2 });
    expect(profileFor('low', 2)).toEqual(PROFILES.low);
  });
});
