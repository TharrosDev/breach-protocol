// Pure helpers for the in-match HUD. No DOM here, so the model tests run in Node.
// Legacy references are to public/index.html.
import type { HudView, TokenName } from '../contracts';
import { PLAYER_MAX_HP } from '../../sim/health';

export type ZoneStatus = HudView['zones'][number]['status'];
export type FeedCls = HudView['feed'][number]['cls'];
export type HitKind = Exclude<HudView['hitMarker'], 'none'>;

// Projects a world point to CSS pixels of the HUD root. onScreen is false when the point is behind the camera or
// outside the view.
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly onScreen: boolean;
}
export type WorldProjector = (x: number, y: number, z: number) => ScreenPoint;

export interface FeedKey {
  readonly text: string;
  readonly cls: FeedCls;
}

// Timings from legacy (index.html:1487, 1497, 2524-2540, 2910, 3402-3404 and the fd keyframes at 131).
export const ANNOUNCE_SECONDS = 2.2;
export const DAMAGE_INDICATOR_SECONDS = 1.1;
export const HIT_NUMBER_SECONDS = 0.8;
export const FEED_LIFE_SECONDS = 4;
// The feed line is fully opaque for 80% of its life, then fades to 0 (legacy fd keyframes).
export const FEED_HOLD_SECONDS = FEED_LIFE_SECONDS * 0.8;
export const FEED_MAX = 4;
export const SPOT_MAX = 20;
// Legacy projects spotted hostile boxes at 1.9 m and zone labels at 3.4 m.
export const SPOT_HEIGHT = 1.9;
export const ZONE_MARK_HEIGHT = 3.4;
export const VIGNETTE_MAX_OPACITY = 0.9;
export const LOW_HEALTH_FRACTION = 0.3;
// Legacy hudFx timers: hit 0.12 s, kill and head 0.35 s.
export const HIT_SECONDS: Record<HitKind, number> = { hit: 0.12, kill: 0.35, head: 0.35 };
export const HIT_TOKEN: Record<HitKind, TokenName> = { hit: 'hit', kill: 'kill', head: 'kill' };
export const ZONE_TOKEN: Record<ZoneStatus, TokenName> = {
  idle: 'objective-idle',
  capturing: 'objective-capturing',
  contested: 'objective-contested',
  captured: 'objective-captured',
};
// Legacy feed classes (index.html:182-249 .fd.kill/.death/.good/.warn). A plain line uses ink.
export const FEED_TOKEN: Record<FeedCls, TokenName> = {
  kill: 'kill',
  death: 'hostile',
  good: 'good',
  warn: 'warning',
  '': 'ink',
};

// CSS reference to a colour token, for inline styles.
export function tokenVar(name: TokenName): string {
  return `var(--tok-${name})`;
}

const clamp = (value: number, lo: number, hi: number): number => {
  if (Number.isNaN(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
};

// Clamps to 0..1. NaN reads as 0.
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

// Wraps an angle to (-PI, PI].
export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export interface CompassOffset {
  readonly visible: boolean;
  // Left position of the marker on the strip, in percent. 50 is the centre (facing the bearing).
  readonly percent: number;
}

// Legacy placeOnCompass (index.html:3340-3345). Bearings more than 90 degrees off the view centre are hidden.
export function compassOffset(bearing: number, yaw: number): CompassOffset {
  const d = wrapAngle(bearing - yaw);
  return {
    visible: Math.abs(d) <= Math.PI / 2,
    percent: 50 - (d / (Math.PI / 2)) * 50,
  };
}

// Bearing from the player to a point, in the same convention as legacy (atan2 of x over z).
export function zoneBearing(playerX: number, playerZ: number, x: number, z: number): number {
  return Math.atan2(x - playerX, z - playerZ);
}

// Legacy spotted box size (index.html:3370): 900 / distance, clamped to 18..64 px.
export function markerSize(dist: number): number {
  return clamp(900 / Math.max(dist, 1), 18, 64);
}

// Legacy crosshair gap (index.html:2889): 5 px plus 220 px per unit of spread.
export function gapFromSpread(spread: number): number {
  if (!Number.isFinite(spread)) return 5;
  return 5 + spread * 220;
}

// Legacy killstreak bar (index.html:2866-2870): full when ready or when no further reward exists.
export function killstreakProgress(streak: number, next: number | null, ready: boolean): number {
  if (ready || next === null || next <= 0) return 1;
  return clamp01(streak / next);
}

// Enemy ticket bar (index.html:2891). A zero or missing start reads as empty.
export function ticketFraction(tickets: number, start: number): number {
  if (!(start > 0)) return 0;
  return clamp01(tickets / start);
}

// Legacy ammo line (index.html:2863).
export function formatAmmo(ammo: number, reserve: number, reloading: boolean): string {
  return reloading ? 'RELOADING' : `${String(ammo)} / ${String(reserve)}`;
}

// Whole seconds, rounded up, never negative (legacy Math.ceil of the timers, index.html:2897-2898).
export function formatTimer(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0';
  return String(Math.max(0, Math.ceil(seconds)));
}

// Health number (legacy Math.ceil(P.hp), index.html:2867).
export function formatHealth(hp: number): string {
  return formatTimer(hp);
}

// Opacity of a feed line at its age in seconds: opaque, then a linear fade over the last fifth of its life.
export function feedFade(age: number): number {
  if (!(age > FEED_HOLD_SECONDS)) return 1;
  if (age >= FEED_LIFE_SECONDS) return 0;
  return 1 - (age - FEED_HOLD_SECONDS) / (FEED_LIFE_SECONDS - FEED_HOLD_SECONDS);
}

// Player health as a fraction of full health (100 in the sim).
export function hpFraction(hp: number): number {
  return clamp01(hp / PLAYER_MAX_HP);
}

export function isLowHealth(hp: number): boolean {
  return hpFraction(hp) <= LOW_HEALTH_FRACTION;
}

export function squadFraction(hp: number, maxHp: number): number {
  if (!(maxHp > 0)) return 0;
  return clamp01(hp / maxHp);
}

// CSS scaleX value for a bar fill, to three decimals.
export function scaleX(fraction: number): string {
  return `scaleX(${clamp01(fraction).toFixed(3)})`;
}

// Matches the entries of a newest-first feed list against the previous list. For each entry of next, returns its
// index in prev, or -1 when it is new. The feed is prepended in the sim, so new entries sit at the front. Old entries
// keep their index even when the sim trims the tail.
export function matchFeed(prev: readonly FeedKey[], next: readonly FeedKey[]): number[] {
  const out: number[] = next.map(() => -1);
  for (let shift = 0; shift < next.length; shift++) {
    const overlap = Math.min(prev.length, next.length - shift);
    let same = overlap > 0;
    for (let j = 0; same && j < overlap; j++) {
      const a = next[shift + j];
      const b = prev[j];
      same = a !== undefined && b !== undefined && a.text === b.text && a.cls === b.cls;
    }
    if (same) {
      for (let j = 0; j < overlap; j++) out[shift + j] = j;
      return out;
    }
  }
  return out;
}
