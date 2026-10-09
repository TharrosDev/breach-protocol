import type { Quality } from '../persist/schema';

export type { Quality } from '../persist/schema';

export interface QualityProfile {
  shadows: boolean;
  pixelRatioCap: number;
  post: boolean;
  hemiIntensity: number;
  grassCount: number;
  lampCount: number;
  rainOnSubstation: boolean;
  muzzleLight: boolean;
}

// Legacy values from public/index.html: applyQuality (line 711-722), grass (1092), lamps (1093), rain (3156).
// The hemisphere value is 0.55 with post and 0.9 without; High always has post when the modules load.
export const PROFILES: Record<Quality, QualityProfile> = {
  high: {
    shadows: true,
    pixelRatioCap: 2,
    post: true,
    hemiIntensity: 0.55,
    grassCount: 900,
    lampCount: 6,
    rainOnSubstation: true,
    muzzleLight: true,
  },
  low: {
    shadows: false,
    pixelRatioCap: 1,
    post: false,
    hemiIntensity: 0.9,
    grassCount: 260,
    lampCount: 6,
    rainOnSubstation: false,
    muzzleLight: false,
  },
};

// Pixel ratio is min(devicePixelRatio, 2) at High and 1 at Low (legacy index.html:713).
export function profileFor(q: Quality, devicePixelRatio: number): QualityProfile {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const base = PROFILES[q];
  return { ...base, pixelRatioCap: q === 'high' ? Math.min(dpr, 2) : 1 };
}
