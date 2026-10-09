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

interface Candidate {
  target: Target;
  pos: Vec3;
  eyeY: number;
  sightR: number;
}

// Nearest target that is inside sight range, has a clear line from the enemy eye, and is not hidden by smoke.
// Port of the candidate loop in legacy updEnemy (index.html:2256-2269).
export function visibleTarget(e: Enemy, w: AiWorld): Sighting | null {
  const cands: Candidate[] = [];
  if (w.player.alive) {
    cands.push({
      target: { kind: 'player' },
      pos: { x: w.player.pos.x, y: w.player.pos.y, z: w.player.pos.z },
      eyeY: w.player.pos.y + w.player.eyeHeight,
      sightR: e.sight * (w.player.ghost ? GHOST_SIGHT_FACTOR : 1),
    });
  }
  w.operators.forEach((o, index) => {
    if (!o.alive) return;
    cands.push({
      target: { kind: 'operator', index },
      pos: { x: o.pos.x, y: 0, z: o.pos.z },
      eyeY: OPERATOR_EYE_Y,
      sightR: e.sight,
    });
  });

  const eye: Vec3 = { x: e.pos.x, y: HOSTILE_EYE_Y, z: e.pos.z };
  let best: Sighting | null = null;
  let bestD = Infinity;
  for (const c of cands) {
    if (Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z) > c.sightR) continue;
    const eyeT: Vec3 = { x: c.pos.x, y: c.eyeY, z: c.pos.z };
    const d3 = distance3(eye, eyeT);
    if (d3 >= bestD) continue;
    if (!losClear(eye, eyeT, w) || smokeBlocks(eye, eyeT, w.smokes)) continue;
    best = { target: c.target, pos: c.pos, eyeY: c.eyeY };
    bestD = d3;
  }
  return best;
}

// Segment from a to b has no world box in the way (legacy losClear, index.html:866-872).
export function losClear(a: Vec3, b: Vec3, w: AiWorld): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.01) return true;
  const dir: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };
  return w.collision.raycast(a, dir, dist - 0.05) === null;
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
