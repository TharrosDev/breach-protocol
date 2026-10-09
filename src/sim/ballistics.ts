import type { WeaponDef } from '../content/weapons';

export interface SpreadState {
  spread: number;
  ads: boolean;
  moving: boolean;
  sprinting: boolean;
  reflex: boolean;
}

// Full damage up to half of range, then linear down to 0.7 at range, clamped beyond.
// Legacy: index.html:1872-1876.
export function falloff(distance: number, range: number): number {
  const start = range / 2;
  const t = Math.max(0, Math.min(1, (distance - start) / start));
  return 1 + (0.7 - 1) * t;
}

export function hitDamage(w: WeaponDef, distance: number, head: boolean): number {
  return w.dmg * (head ? w.headMul : 1) * falloff(distance, w.range);
}

// Legacy: index.html:1815. The reflex factor is applied here, once, as a multiplier.
// `w` is kept in the signature so callers pass the same def to every ballistics call.
export function spreadFor(_w: WeaponDef, state: SpreadState): number {
  return (
    state.spread *
    (state.ads ? 0.55 : 1) *
    (state.moving ? 1.35 : 1) *
    (state.sprinting ? 2 : 1) *
    (state.reflex ? 0.85 : 1)
  );
}
