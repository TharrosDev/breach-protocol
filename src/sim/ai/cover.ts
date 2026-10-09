import type { Vec2, Vec3 } from '../../core/math';
import type { AiWorld, Enemy } from '../entities';
import { losClear, smokeBlocks } from './perception';

const COVER_SAMPLES = 12;
const COVER_MIN_R = 3;
const COVER_SPAN = 5; // radius 3..8 m
const COVER_EYE_Y = 1.2;
const TAU = Math.PI * 2;

// Picks the walkable point 3..8 m from the enemy that is closest to it and hidden from the target
// (no clear line, or smoke in the way). Port of legacy findCover (index.html:2149-2161).
// Returns null when none of the 12 samples is hidden.
export function findCover(e: Enemy, tx: number, ty: number, tz: number, w: AiWorld): Vec2 | null {
  const target: Vec3 = { x: tx, y: ty, z: tz };
  let best: Vec2 | null = null;
  let bestR = Infinity;
  for (let k = 0; k < COVER_SAMPLES; k += 1) {
    const a = w.rng.next() * TAU;
    const r = COVER_MIN_R + w.rng.next() * COVER_SPAN;
    const x = e.pos.x + Math.cos(a) * r;
    const z = e.pos.z + Math.sin(a) * r;
    if (!w.nav.isWalk(x, z)) continue;
    const spot: Vec3 = { x, y: COVER_EYE_Y, z };
    // Visible from the target means the sample is not cover.
    if (losClear(target, spot, w) && !smokeBlocks(target, spot, w.smokes)) continue;
    if (r < bestR) {
      bestR = r;
      best = { x, z };
    }
  }
  return best;
}
