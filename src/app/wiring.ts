// Pure helpers used by game.ts. No THREE and no DOM, so they run in the unit tests.
import type { Perk } from '../content/weapons';
import { PROFILES } from '../render/quality';

// Legacy clamps frame time to 0.05 s for the viewmodel and the effects (index.html:2912 onward).
export const MAX_FX_DT = 0.05;
// Legacy muzzle flash length after a shot (index.html:1820).
export const MUZZLE_TIME = 0.05;
// Tracers start 0.8 m out from the eye along the shot ray (index.html:1871).
export const TRACER_START = 0.8;

// Frame time for the viewmodel and effects. Negative and non-finite values count as zero.
export function capDt(frameDt: number, max = MAX_FX_DT): number {
  return Number.isFinite(frameDt) && frameDt > 0 ? Math.min(frameDt, max) : 0;
}

// Full reload time with the perk applied (index.html:1800 and 1867 use the same 0.7 factor).
export function reloadTotal(reloadSeconds: number, perk: Perk): number {
  return reloadSeconds * (perk === 'fasthands' ? 0.7 : 1);
}

// Reload progress from the seconds left on the weapon. 0 when not reloading, 1 when the reload is done.
export function reloadProgress(reloadLeft: number, total: number): number {
  if (reloadLeft <= 0 || total <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - reloadLeft / total));
}

// The gun is drawn only while alive and not on the DMR scope (index.html:1907-1910).
export function viewmodelVisible(alive: boolean, scoped: boolean): boolean {
  return alive && !scoped;
}

// Speed of the head-bob timer (index.html:1778).
export function bobSpeed(sprinting: boolean, moving: boolean): number {
  return sprinting ? 13 : moving ? 8.5 : 0;
}

// Hemisphere light: 0.55 when the post chain loaded, 0.9 without it (quality.ts and index.html:718).
export function hemiIntensityFor(postLoaded: boolean): number {
  return postLoaded ? PROFILES.high.hemiIntensity : PROFILES.low.hemiIntensity;
}
