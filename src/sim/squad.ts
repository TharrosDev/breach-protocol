import type { Vec2, Vec3 } from '../core/math';
import type { Rng } from '../core/rng';
import { ALLY_RESPAWN, REVIVE_TIME } from '../content/tuning';
import type { CollisionWorld } from './collision';
import type { AiEvent, AiWorld, Enemy, Operator, PathState, SmokeZone } from './entities';
import type { PathBudget } from './nav/types';

// Operator (ally) squad, ported from the legacy allies block (public/index.html:2393-2515) and its
// movement helpers (stepTo, goTo, handleStuck, openZoneFrom: index.html:2110-2170). Pure state
// updates: damage and kills are resolved by the combat agent, which reads the events returned here.

export type OperatorEvent = { type: 'revive'; by: Operator } | AiEvent;

export interface OperatorOptions {
  // True while the player is downed (bleeding out). Not part of PlayerView.
  playerDowned: boolean;
  // Respawn base used when the player is dead (legacy SPAWNS[0]). Falls back to the player's position.
  spawn?: Vec2;
}

// PlayerView.order values (legacy ORDERS, index.html:473).
const ORDER_ATTACK = 0;
const ORDER_HOLD = 1;
const ORDER_FOLLOW = 2;

// Legacy ALLY_OFFSETS (index.html:2393).
const SLOTS = [
  { name: 'Ally 1', ox: -3, oz: -2 },
  { name: 'Ally 2', ox: 3, oz: -2 },
] as const;

const MAX_HP = 100;
const EYE_Y = 1.5;
const ENEMY_AIM_Y = 1.0; // legacy aim point for allyFire (index.html:2426)
const LOS_MARGIN = 0.05; // legacy losClear shortens the ray by 0.05 (index.html:871)
const SPEED_ATTACK = 3.6;
const SPEED_FOLLOW = 4.2;
const SPEED_DOWNED = 4.6;
const RANGE_HOLD = 40;
const RANGE_OPEN = 55;
const ATTACK_CLOSE_M = 20; // ATTACK stops advancing on a target within this distance
const FOLLOW_STOP_M = 4;
const RECALL_M = 12; // ATTACK with the player this far away returns to the player
const ZONE_MAX_M = 45;
const DOWNED_LEAD_M = 0.8;
const REVIVE_RANGE_M = 2.2;
const CLEARANCE_R = 0.6; // legacy placeAlly openPoint radius (index.html:2409)
const BODY_R = 0.4; // legacy stepTo moveCollide radius (index.html:2115)
const WAYPOINT_R = 0.2;
const REPLAN_S = 1.5;
const REPLAN_GOAL_M = 4;
const FIRE_BASE_S = 0.14;
const FIRE_JITTER_S = 0.05;
const SPREAD_BASE = 0.03;
const SPREAD_PER_M = 0.0012;
const STUCK_S = 0.7;
const STUCK_MIN_FRAC = 0.2;
const MOVING_EPS = 0.001;
const ANIM_RATE = 9;
// Hurt operators (below this share of health) break for cover, mend there, and come back after COVER_S seconds.
const COVER_HP_FRACTION = 0.5;
const COVER_S = 5;
const COVER_REGEN = 6;
const COVER_REACH = 0.8;
const COVER_SAMPLES = 10;
const COVER_MIN_R = 3;
const COVER_SPAN = 5;

// findPath takes a budget and may spend it itself. The budget is spent once here via take(), so
// findPath receives a budget that always grants and the slot is not charged twice.
const GRANTED: PathBudget = { take: () => true };

export function createOperator(index: 0 | 1, rng?: Rng): Operator {
  const slot = SLOTS[index];
  return {
    name: slot.name,
    ox: slot.ox,
    oz: slot.oz,
    alive: true,
    hp: MAX_HP,
    maxHp: MAX_HP,
    pos: { x: 0, z: 0 },
    yaw: 0,
    fireT: 0,
    deathT: 0,
    kills: 0,
    reviveT: 0,
    moving: false,
    phase: rng === undefined ? 0 : rng.range(0, 6),
    ...emptyPath(),
  };
}

// Puts the operator at basePos plus its offset when the spot is clear, else at basePos (legacy placeAlly).
export function placeOperator(a: Operator, basePos: Vec2, collision: CollisionWorld): void {
  const x = basePos.x + a.ox;
  const z = basePos.z + a.oz;
  if (collision.pointFree(x, z, CLEARANCE_R)) {
    a.pos.x = x;
    a.pos.z = z;
  } else {
    a.pos.x = basePos.x;
    a.pos.z = basePos.z;
  }
}

// Respawn: placed at basePos, alive, full hp. Path state is cleared so a stale route is not followed.
export function reviveOperator(a: Operator, basePos: Vec2, collision: CollisionWorld): void {
  placeOperator(a, basePos, collision);
  a.alive = true;
  a.hp = a.maxHp;
  a.deathT = 0;
  a.reviveT = 0;
  a.moving = false;
  resetPath(a);
}

// Called by the combat agent when damage kills an operator. The respawn timer starts here.
export function killOperator(a: Operator): void {
  a.alive = false;
  a.deathT = ALLY_RESPAWN;
  a.reviveT = 0;
  a.moving = false;
}

// Shot direction for an operator firing at an enemy: aimed at the enemy with the legacy accuracy
// spread (index.html:2424-2431). The operatorFire event has no aim, so the combat agent calls this
// to resolve the shot. Returns a unit vector.
export function operatorAim(a: Operator, enemy: Enemy, rng: Rng): Vec3 {
  const ex = enemy.pos.x - a.pos.x;
  const ey = ENEMY_AIM_Y - EYE_Y;
  const ez = enemy.pos.z - a.pos.z;
  const dist = Math.hypot(ex, ey, ez);
  const sp = SPREAD_BASE + dist * SPREAD_PER_M;
  const dx = ex / dist;
  const dy = ey / dist;
  const dz = ez / dist;
  const x = dx + rng.range(-sp, sp);
  const y = dy + rng.range(-sp, sp);
  const n = Math.hypot(x, y, dz);
  return { x: x / n, y: y / n, z: dz / n };
}

// Advances one operator by dt and returns the events it produced. Damage is not resolved here.
export function updOperator(a: Operator, w: AiWorld, dt: number, opts?: OperatorOptions): OperatorEvent[] {
  if (!a.alive) {
    a.deathT -= dt;
    if (a.deathT <= 0) reviveOperator(a, respawnBase(w, opts), w.collision);
    return [];
  }

  a.fireT -= dt;
  a.unstuck -= dt;
  const P = w.player;
  const events: OperatorEvent[] = [];

  // A downed player comes first: run over and hold position until the revive completes.
  if (opts?.playerDowned === true) {
    const dP = Math.hypot(P.pos.x - a.pos.x, P.pos.z - a.pos.z);
    let mv = -1;
    if (dP > REVIVE_RANGE_M) {
      mv = goTo(a, w, P.pos.x + DOWNED_LEAD_M, P.pos.z + DOWNED_LEAD_M, SPEED_DOWNED, dt);
    } else {
      a.reviveT += dt;
      if (a.reviveT >= REVIVE_TIME) {
        a.reviveT = 0;
        events.push({ type: 'revive', by: a });
      }
    }
    handleStuck(a, w, mv, SPEED_DOWNED, dt);
    finishMove(a, mv, dt);
    return events;
  }
  a.reviveT = 0;

  const offX = P.pos.x + a.ox;
  const offZ = P.pos.z + a.oz;
  const range = P.order === ORDER_HOLD ? RANGE_HOLD : RANGE_OPEN;
  const tgt = findTarget(a, w, range);
  let mv = -1;
  let speed = SPEED_ATTACK;

  // Cover: a hurt operator under fire ducks out of the target's sight and mends while it waits.
  a.coverT = (a.coverT ?? 0) - dt;
  if (a.coverT <= 0) a.cover = null;
  if (tgt !== null && a.cover == null && a.coverT <= 0 && a.hp < a.maxHp * COVER_HP_FRACTION) {
    a.cover = findOperatorCover(a, tgt, w);
    a.coverT = COVER_S;
  }
  const inCover = a.cover != null && a.coverT > 0;
  if (a.cover != null && inCover) {
    if (Math.hypot(a.cover.x - a.pos.x, a.cover.z - a.pos.z) > COVER_REACH) {
      mv = goTo(a, w, a.cover.x, a.cover.z, SPEED_FOLLOW, dt);
      speed = SPEED_FOLLOW;
    } else {
      a.hp = Math.min(a.maxHp, a.hp + COVER_REGEN * dt);
    }
  }

  if (inCover && tgt === null) {
    // Wait it out behind the cover.
  } else if (tgt !== null) {
    const dTgt = Math.hypot(tgt.pos.x - a.pos.x, tgt.pos.z - a.pos.z);
    if (!inCover && P.order === ORDER_ATTACK && dTgt > ATTACK_CLOSE_M) {
      mv = goTo(a, w, tgt.pos.x, tgt.pos.z, SPEED_ATTACK, dt);
      speed = SPEED_ATTACK;
    }
    if (!inCover && P.order === ORDER_FOLLOW && Math.hypot(offX - a.pos.x, offZ - a.pos.z) > FOLLOW_STOP_M) {
      mv = goTo(a, w, offX, offZ, SPEED_FOLLOW, dt);
      speed = SPEED_FOLLOW;
    }
    if (a.fireT <= 0) {
      a.fireT = FIRE_BASE_S + w.rng.range(0, FIRE_JITTER_S);
      events.push({ type: 'operatorFire', operator: a, enemy: tgt });
    }
    a.yaw = Math.atan2(tgt.pos.x - a.pos.x, tgt.pos.z - a.pos.z);
  } else if (P.order === ORDER_HOLD) {
    // Hold position: nothing to do.
  } else if (P.order === ORDER_FOLLOW && P.alive) {
    const dP = Math.hypot(P.pos.x - a.pos.x, P.pos.z - a.pos.z);
    if (dP > FOLLOW_STOP_M) {
      mv = goTo(a, w, offX, offZ, SPEED_FOLLOW, dt);
      speed = SPEED_FOLLOW;
    }
  } else {
    // ATTACK, or FOLLOW with the player dead: return to the player when far, else take the nearest open zone.
    const dP = P.alive ? Math.hypot(P.pos.x - a.pos.x, P.pos.z - a.pos.z) : 0;
    if (dP > RECALL_M) {
      mv = goTo(a, w, offX, offZ, SPEED_FOLLOW, dt);
      speed = SPEED_FOLLOW;
    } else {
      const zn = openZoneFrom(w.zones, a.pos.x, a.pos.z);
      if (zn !== null && Math.hypot(zn.x - a.pos.x, zn.z - a.pos.z) < ZONE_MAX_M) {
        mv = goTo(a, w, zn.x + a.ox, zn.z + a.oz, SPEED_ATTACK, dt);
        speed = SPEED_ATTACK;
      }
    }
  }

  handleStuck(a, w, mv, speed, dt);
  finishMove(a, mv, dt);
  return events;
}

// The nearest walkable point 3..8 m away that the target cannot see (no clear line, or smoke in the way), or null.
function findOperatorCover(a: Operator, target: Enemy, w: AiWorld): Vec2 | null {
  const from: Vec3 = { x: target.pos.x, y: EYE_Y, z: target.pos.z };
  let best: Vec2 | null = null;
  let bestR = Infinity;
  for (let k = 0; k < COVER_SAMPLES; k += 1) {
    const ang = w.rng.range(0, Math.PI * 2);
    const r = COVER_MIN_R + w.rng.range(0, COVER_SPAN);
    const x = a.pos.x + Math.cos(ang) * r;
    const z = a.pos.z + Math.sin(ang) * r;
    if (!w.nav.isWalk(x, z)) continue;
    const spot: Vec3 = { x, y: EYE_Y, z };
    if (losClear(w.collision, from, spot) && !smokeBlocks(w.smokes, from, spot)) continue;
    if (r < bestR) {
      bestR = r;
      best = { x, z };
    }
  }
  return best;
}

function emptyPath(): PathState {
  return {
    path: null,
    pathIdx: 0,
    pathT: 0,
    pathTx: 0,
    pathTz: 0,
    stuckT: 0,
    unstuck: 0,
    sideX: 0,
    sideZ: 0,
  };
}

function resetPath(a: PathState): void {
  a.path = null;
  a.pathIdx = 0;
  a.pathT = 0;
  a.stuckT = 0;
  a.unstuck = 0;
}

function respawnBase(w: AiWorld, opts?: OperatorOptions): Vec2 {
  if (w.player.alive) return { x: w.player.pos.x, z: w.player.pos.z };
  return opts?.spawn ?? { x: w.player.pos.x, z: w.player.pos.z };
}

// Nearest living enemy in range with a clear line of sight and no smoke in between (legacy 2478-2486).
function findTarget(a: Operator, w: AiWorld, range: number): Enemy | null {
  const eye: Vec3 = { x: a.pos.x, y: EYE_Y, z: a.pos.z };
  const rangeSq = range * range;
  let best: Enemy | null = null;
  let bestSq = Infinity;
  for (const e of w.enemies) {
    if (!e.alive) continue;
    const dSq = (e.pos.x - a.pos.x) ** 2 + (e.pos.z - a.pos.z) ** 2;
    if (dSq > bestSq || dSq > rangeSq) continue;
    const to: Vec3 = { x: e.pos.x, y: EYE_Y, z: e.pos.z };
    if (losClear(w.collision, eye, to) && !smokeBlocks(w.smokes, eye, to)) {
      best = e;
      bestSq = dSq;
    }
  }
  return best;
}

// Legacy losClear (index.html:866-872): no collider between a and b, ignoring the last 0.05 m.
function losClear(collision: CollisionWorld, a: Vec3, b: Vec3): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.01) return true;
  const dir: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };
  return collision.raycast(a, dir, dist - LOS_MARGIN) === null;
}

// Legacy smokeBlocks (index.html:875-878): a smoke sphere touching the segment blocks sight.
function smokeBlocks(smokes: readonly SmokeZone[], a: Vec3, b: Vec3): boolean {
  return smokes.some((s) => distSeg(s.pos, a, b) < s.r);
}

function distSeg(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz || 1e-6;
  const t = Math.min(Math.max((apx * abx + apy * aby + apz * abz) / len2, 0), 1);
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z);
}

// Legacy openZoneFrom (index.html:2162-2170): nearest zone that is not captured.
function openZoneFrom(
  zones: readonly { x: number; z: number; captured: boolean }[],
  x: number,
  z: number,
): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestSq = Infinity;
  for (const zn of zones) {
    if (zn.captured) continue;
    const dSq = (x - zn.x) ** 2 + (z - zn.z) ** 2;
    if (dSq < bestSq) {
      bestSq = dSq;
      best = zn;
    }
  }
  return best;
}

// Legacy stepTo (index.html:2110-2120). Returns -1 when already at the target, else the distance moved.
function stepTo(a: Operator, w: AiWorld, tx: number, tz: number, speed: number, dt: number): number {
  let dx = tx - a.pos.x;
  let dz = tz - a.pos.z;
  let dd = Math.hypot(dx, dz);
  if (a.unstuck > 0) {
    dx = a.sideX;
    dz = a.sideZ;
    dd = 1;
  } else if (dd < 0.05) {
    return -1;
  }
  const s = Math.min(dd, speed * dt);
  const ox = a.pos.x;
  const oz = a.pos.z;
  a.pos.x += (dx / dd) * s;
  a.pos.z += (dz / dd) * s;
  w.collision.pushOut(a.pos, BODY_R);
  a.yaw = Math.atan2(dx, dz);
  return Math.hypot(a.pos.x - ox, a.pos.z - oz);
}

// Legacy goTo (index.html:2121-2139). Straight line when the nav grid allows it, else follow a path.
function goTo(a: Operator, w: AiWorld, tx: number, tz: number, speed: number, dt: number): number {
  if (w.nav.lineWalk(a.pos.x, a.pos.z, tx, tz)) {
    a.path = null;
    return stepTo(a, w, tx, tz, speed, dt);
  }
  a.pathT -= dt;
  const goalMoved = Math.hypot(a.pathTx - tx, a.pathTz - tz) > REPLAN_GOAL_M;
  if (a.path === null || a.pathT <= 0 || goalMoved) {
    if (w.pathBudget.take()) {
      a.path = w.nav.findPath(a.pos.x, a.pos.z, tx, tz, GRANTED) ?? [];
      a.pathIdx = 0;
      a.pathT = REPLAN_S;
      a.pathTx = tx;
      a.pathTz = tz;
    }
  }
  const path = a.path;
  if (path === null || a.pathIdx >= path.length) return stepTo(a, w, tx, tz, speed, dt);
  const wp = path[a.pathIdx];
  if (wp === undefined) return stepTo(a, w, tx, tz, speed, dt);
  if (Math.hypot(a.pos.x - wp.x, a.pos.z - wp.z) < WAYPOINT_R) {
    a.pathIdx += 1;
    const next = path[a.pathIdx];
    if (next === undefined) return stepTo(a, w, tx, tz, speed, dt);
    return stepTo(a, w, next.x, next.z, speed, dt);
  }
  return stepTo(a, w, wp.x, wp.z, speed, dt);
}

// Legacy handleStuck (index.html:2140-2147): after 0.7 s of near-zero progress, sidestep for 1 s.
function handleStuck(a: Operator, w: AiWorld, mv: number, speed: number, dt: number): void {
  if (mv < 0) return;
  if (mv < speed * dt * STUCK_MIN_FRAC) a.stuckT += dt;
  else a.stuckT = 0;
  if (a.stuckT > STUCK_S && a.unstuck <= 0) {
    a.stuckT = 0;
    a.unstuck = 1;
    const ang = w.rng.range(0, Math.PI * 2);
    a.sideX = Math.cos(ang);
    a.sideZ = Math.sin(ang);
  }
}

function finishMove(a: Operator, mv: number, dt: number): void {
  a.moving = mv > MOVING_EPS;
  a.phase += dt * (a.moving ? ANIM_RATE : 0);
}
