import type { Vec2 } from '../../core/math';
import type { AiWorld, PathState } from '../entities';

// A body that can walk: PathState plus position and facing. Enemy and Operator both satisfy this.
export interface Mover extends PathState {
  pos: Vec2;
  yaw: number;
}

const BODY_R = 0.4; // legacy moveCollide radius (index.html:2115, 2117)
const PATH_TTL = 1.5; // seconds before a path is recomputed (index.html:2134)
const PATH_RETARGET_SQ = 4; // target moved more than 2 m: recompute (legacy d2 > 4)
const WAYPOINT_REACH_SQ = 0.2;
const STUCK_TIME = 0.7;
const UNSTUCK_TIME = 1;
const STUCK_SPEED_FRACTION = 0.2;

// One step toward (tx, tz). Returns the distance moved, -1 when already there (no move attempted).
// Port of legacy stepTo (index.html:2110-2120).
export function stepTo(o: Mover, tx: number, tz: number, speed: number, dt: number, w: AiWorld): number {
  let dx = tx - o.pos.x;
  let dz = tz - o.pos.z;
  let dd = Math.hypot(dx, dz);
  if (o.unstuck > 0) {
    dx = o.sideX;
    dz = o.sideZ;
    dd = 1;
  } else if (dd < 0.05) {
    return -1;
  }
  const s = Math.min(dd, speed * dt);
  const ox = o.pos.x;
  const oz = o.pos.z;
  o.pos.x += (dx / dd) * s;
  o.pos.z += (dz / dd) * s;
  w.collision.pushOut(o.pos, BODY_R);
  o.yaw = Math.atan2(dx, dz);
  return Math.hypot(o.pos.x - ox, o.pos.z - oz);
}

// Walks toward (tx, tz): straight when the line is walkable, otherwise along an A* path that is
// refreshed every 1.5 s or when the target moves more than 2 m. Returns as stepTo does.
// Port of legacy goTo (index.html:2121-2139).
export function goTo(o: Mover, tx: number, tz: number, speed: number, dt: number, w: AiWorld): number {
  if (w.nav.lineWalk(o.pos.x, o.pos.z, tx, tz)) {
    o.path = null;
    return stepTo(o, tx, tz, speed, dt, w);
  }
  o.pathT -= dt;
  if (o.path === null || o.pathT <= 0 || sqDist(o.pathTx, o.pathTz, tx, tz) > PATH_RETARGET_SQ) {
    // findPath spends the budget itself (NavGrid contract). A null result (unreachable, or budget
    // spent) is stored as an empty path, as legacy `findPath(...) || []` did, for PATH_TTL seconds.
    const found = w.nav.findPath(o.pos.x, o.pos.z, tx, tz, w.pathBudget);
    o.path = found ?? [];
    o.pathIdx = 0;
    o.pathT = PATH_TTL;
    o.pathTx = tx;
    o.pathTz = tz;
  }
  const path = o.path;
  if (o.pathIdx >= path.length) return stepTo(o, tx, tz, speed, dt, w);
  let next = path[o.pathIdx];
  if (next === undefined) return stepTo(o, tx, tz, speed, dt, w);
  if (sqDist(o.pos.x, o.pos.z, next.x, next.z) < WAYPOINT_REACH_SQ) {
    o.pathIdx += 1;
    const following = path[o.pathIdx];
    if (following === undefined) return stepTo(o, tx, tz, speed, dt, w);
    next = following;
  }
  return stepTo(o, next.x, next.z, speed, dt, w);
}

// Detects a stall (moved less than 20% of the expected step for 0.7 s) and starts a 1 s sideways
// escape in a random direction. mv is the result of the last goTo; negative means no move was tried.
// Port of legacy handleStuck (index.html:2140-2147).
export function handleStuck(o: PathState, mv: number, speed: number, dt: number, w: AiWorld): void {
  if (mv < 0) return;
  if (mv < speed * dt * STUCK_SPEED_FRACTION) o.stuckT += dt;
  else o.stuckT = 0;
  if (o.stuckT > STUCK_TIME && o.unstuck <= 0) {
    o.stuckT = 0;
    o.unstuck = UNSTUCK_TIME;
    const a = w.rng.next() * Math.PI * 2;
    o.sideX = Math.cos(a);
    o.sideZ = Math.sin(a);
  }
}

function sqDist(ax: number, az: number, bx: number, bz: number): number {
  return (ax - bx) ** 2 + (az - bz) ** 2;
}
