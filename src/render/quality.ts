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
  // The sun shadow map is redrawn every this many frames (1 = every frame). Static geometry does not move, so only
  // the moving bodies lag, by a frame or two at 60 fps.
  shadowEvery: number;
  // Bloom works at this fraction of the half-resolution base mip (0.5 = a quarter of the screen size).
  bloomScale: number;
}

// Legacy values from public/index.html: applyQuality (line 711-722), grass (1092), lamps (1093), rain (3156).
// The hemisphere value is 0.55 with post and 0.9 without; High always has post when the modules load.
const HIGH_PIXEL_RATIO_CAP = 1.5;

export const PROFILES: Record<Quality, QualityProfile> = {
  high: {
    shadows: true,
    pixelRatioCap: 1.5,
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
    shadowEvery: 2,
    bloomScale: 0.5,
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
    shadowEvery: 1,
    bloomScale: 1,
  },
};

// Pixel ratio is min(devicePixelRatio, 1.5) at High and 1 at Low. Legacy used a cap of 2 at High (index.html:713); 1.5
// costs 44 % fewer pixels on a 2x display and the extra sharpness is hard to see in motion.
export function profileFor(q: Quality, devicePixelRatio: number): QualityProfile {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const base = PROFILES[q];
  return { ...base, pixelRatioCap: q === 'high' ? Math.min(dpr, HIGH_PIXEL_RATIO_CAP) : 1 };
}
