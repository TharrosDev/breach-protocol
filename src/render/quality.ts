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
  // Visual upgrade knobs. Low keeps every one of these cheap.
  // Multiplier on particle counts for impacts, sparks and blood.
  particleScale: number;
  // Fire and smoke puffs per explosion.
  explosionPuffs: number;
  // Short-lived point lights for explosions.
  dynamicLights: boolean;
  // Floating dust and embers around the player.
  ambientCount: number;
  // Scattered ground detail patches and stones.
  groundDetail: number;
  // Additive glow around tracers and a custom grade pass.
  glow: boolean;
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
    particleScale: 1,
    explosionPuffs: 16,
    dynamicLights: true,
    ambientCount: 140,
    groundDetail: 140,
    glow: true,
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
    particleScale: 0.5,
    explosionPuffs: 5,
    dynamicLights: false,
    ambientCount: 36,
    groundDetail: 30,
    glow: false,
  },
};

// Pixel ratio is min(devicePixelRatio, 2) at High and 1 at Low (legacy index.html:713).
export function profileFor(q: Quality, devicePixelRatio: number): QualityProfile {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const base = PROFILES[q];
  return { ...base, pixelRatioCap: q === 'high' ? Math.min(dpr, 2) : 1 };
}
