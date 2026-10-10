import type { Vec3 } from '../../core/math';
import type { AiWorld, Enemy, SmokeZone, Target } from '../entities';

// Hostiles see from 1.5 m (legacy updEnemy eyeE, index.html:2246). Operators are seen at 1.5 m (index.html:2258).
export const HOSTILE_EYE_Y = 1.5;
export const OPERATOR_EYE_Y = 1.5;
// Ghost perk shortens how far hostiles detect the player (index.html:2260).
export const GHOST_SIGHT_FACTOR = 0.7;

export interface Sighting {
  target: Target;
  // Target position: x and z on the ground, y the feet height (0 for operators).
  pos: Vec3;
  // Absolute eye height of the target.
  eyeY: number;
}

// Scratch vectors for the sight test, reused so a tick of many hostiles allocates nothing here. Single-threaded and
// the values never outlive a call.
const EYE: Vec3 = { x: 0, y: 0, z: 0 };
const EYE_T: Vec3 = { x: 0, y: 0, z: 0 };
const DIR: Vec3 = { x: 0, y: 0, z: 0 };

// Tests one candidate against the best so far. Returns the new best distance, or the old one when it does not win.
function tryCandidate(
  e: Enemy,
  w: AiWorld,
  cx: number,
  cy: number,
  cz: number,
  sightR: number,
  bestD: number,
): number {
  if (Math.hypot(cx - e.pos.x, cz - e.pos.z) > sightR) return bestD;
  EYE_T.x = cx;
  EYE_T.y = cy;
  EYE_T.z = cz;
  const d3 = distance3(EYE, EYE_T);
  if (d3 >= bestD) return bestD;
  if (!losClear(EYE, EYE_T, w) || smokeBlocks(EYE, EYE_T, w.smokes)) return bestD;
  return d3;
}

// Nearest target that is inside sight range, has a clear line from the enemy eye, and is not hidden by smoke.
// Port of the candidate loop in legacy updEnemy (index.html:2256-2269). The player is tested first, then the
// operators in order; a later candidate wins only when it is strictly nearer.
export function visibleTarget(e: Enemy, w: AiWorld): Sighting | null {
  EYE.x = e.pos.x;
  EYE.y = HOSTILE_EYE_Y;
  EYE.z = e.pos.z;
  let bestD = Infinity;
  // -2: none, -1: the player, 0..n: that operator.
  let bestIdx = -2;
  if (w.player.alive) {
    const pp = w.player.pos;
    const d = tryCandidate(
      e,
      w,
      pp.x,
      pp.y + w.player.eyeHeight,
      pp.z,
      e.sight * (w.player.ghost ? GHOST_SIGHT_FACTOR : 1),
      bestD,
    );
    if (d < bestD) {
      bestD = d;
      bestIdx = -1;
    }
  }
  const ops = w.operators;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o === undefined || !o.alive) continue;
    const d = tryCandidate(e, w, o.pos.x, OPERATOR_EYE_Y, o.pos.z, e.sight, bestD);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  if (bestIdx === -2) return null;
  if (bestIdx === -1) {
    const pp = w.player.pos;
    return {
      target: { kind: 'player' },
      pos: { x: pp.x, y: pp.y, z: pp.z },
      eyeY: pp.y + w.player.eyeHeight,
    };
  }
  const o = ops[bestIdx];
  if (o === undefined) return null;
  return {
    target: { kind: 'operator', index: bestIdx },
    pos: { x: o.pos.x, y: 0, z: o.pos.z },
    eyeY: OPERATOR_EYE_Y,
  };
}

// Segment from a to b has no world box in the way (legacy losClear, index.html:866-872).
export function losClear(a: Vec3, b: Vec3, w: AiWorld): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.01) return true;
  DIR.x = dx / dist;
  DIR.y = dy / dist;
  DIR.z = dz / dist;
  return w.collision.raycast(a, DIR, dist - 0.05) === null;
}

// Some smoke sphere lies within its radius of the segment a-b (legacy smokeBlocks, index.html:875-878).
export function smokeBlocks(a: Vec3, b: Vec3, smokes: readonly SmokeZone[]): boolean {
  for (const s of smokes) {
    if (distSeg(s.pos, a, b) < s.r) return true;
  }
  return false;
}

function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function distSeg(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz || 1e-6;
  const t = clamp01((apx * abx + apy * aby + apz * abz) / len2);
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z);
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}
