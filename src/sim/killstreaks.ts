import type { Vec3 } from '../core/math';
import { KILLSTREAKS, KILLSTREAK_IDS, UAV_SPOT_FLOOR, type KillstreakId } from '../content/killstreaks';
import { UAV_TIME } from '../content/tuning';
import type { CollisionWorld } from './collision';
import type { Enemy } from './entities';

// Killstreak rules ported from the legacy game: streak awards (awardStreak), the held slot and its use
// (useKillstreak), and the UAV (updKillstreakUAV). Sentry and airstrike live in turret.ts and airstrike.ts.

export interface KillstreakSlot {
  // The ready killstreak (legacy P.ks), or null.
  ks: KillstreakId | null;
  // Killstreaks used so far (legacy P.ksUsed).
  ksUsed: number;
}

export interface UavState {
  // Seconds of UAV time left. The UAV is up while t > 0.
  t: number;
}

// The killstreak earned at exactly this streak count, or null for any other count.
export function checkStreakAward(streak: number): KillstreakId | null {
  for (const id of KILLSTREAK_IDS) {
    if (KILLSTREAKS[id].streak === streak) return id;
  }
  return null;
}

// Name shown when a killstreak is ready, e.g. 'UAV'.
export function readyLabel(id: KillstreakId): string {
  return KILLSTREAKS[id].name;
}

// Legacy awardStreak: the award is stored only when the slot is empty. A new award while one is
// already ready is dropped, so the held killstreak is kept.
export function awardKillstreak(slot: KillstreakSlot, streak: number): KillstreakSlot {
  const id = checkStreakAward(streak);
  if (id === null || slot.ks !== null) return slot;
  return { ks: id, ksUsed: slot.ksUsed };
}

// The ready killstreak to use, or null when the slot is empty. Does not change the slot.
export function takeKillstreak(slot: KillstreakSlot): { id: KillstreakId } | null {
  return slot.ks === null ? null : { id: slot.ks };
}

// Clears the slot and counts one use. Call only after the effect has happened: a sentry that finds
// no clear ground keeps its killstreak (legacy useKillstreak returns early).
export function spendKillstreak(slot: KillstreakSlot): KillstreakSlot {
  return { ks: null, ksUsed: slot.ksUsed + 1 };
}

// A UAV that has just come online for UAV_TIME seconds (legacy useKillstreak: uavT = UAV_TIME).
export function createUav(): UavState {
  return { t: UAV_TIME };
}

// While the UAV is up, every living enemy's spot is held at least at UAV_SPOT_FLOOR. Time then runs down.
// Legacy updKillstreakUAV (index.html:2048-2052), with the spot update before the countdown.
export function stepUav(state: UavState, enemies: readonly Enemy[], dt: number): void {
  if (state.t <= 0) return;
  for (const e of enemies) {
    if (e.alive) e.spot = Math.max(e.spot, UAV_SPOT_FLOOR);
  }
  state.t = Math.max(0, state.t - dt);
}

// True when the segment a-b crosses no world box. Same test as ai/perception.ts losClear
// (index.html:866-872), which takes a full AiWorld; this takes only the collision world.
export function hasLineOfSight(a: Vec3, b: Vec3, world: CollisionWorld): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.01) return true;
  const dir: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };
  return world.raycast(a, dir, dist - 0.05) === null;
}
