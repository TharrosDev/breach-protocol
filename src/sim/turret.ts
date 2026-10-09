import type { Vec2, Vec3 } from '../core/math';
import type { Rng } from '../core/rng';
import {
  SENTRY_AIM_TOL,
  SENTRY_DAMAGE,
  SENTRY_FIRE_INTERVAL,
  SENTRY_HEIGHT,
  SENTRY_MUZZLE,
  SENTRY_OPEN_R,
  SENTRY_PLACE_DISTANCES,
  SENTRY_RANGE,
  SENTRY_SPREAD,
  SENTRY_TURN_RATE,
  SENTRY_WALL_RANGE,
} from '../content/killstreaks';
import { TURRET_TIME } from '../content/tuning';
import { smokeBlocks } from './ai/perception';
import { damageEnemy, EYE_HEIGHT, nearestEnemyHit } from './combat';
import type { CollisionWorld } from './collision';
import type { Enemy, SmokeZone } from './entities';
import { hasLineOfSight } from './killstreaks';

// Sentry turret, ported from the legacy placeTurret (index.html:1536-1553) and updTurrets (1554-1586).

export interface Turret {
  // Turret centre: x and z on the ground, y SENTRY_HEIGHT.
  pos: Vec3;
  // Heading in radians, same convention as the player yaw (atan2(dx, dz)).
  yaw: number;
  // Seconds until the next shot may fire.
  fireT: number;
  // Seconds of life left.
  t: number;
}

// True when a circle of radius r at (x, z) is clear ground.
export type OpenPredicate = (x: number, z: number, r: number) => boolean;

export type PlaceResult = { placed: true; turret: Turret } | { placed: false };

// One shot taken this step. The caller draws the tracer from `from` to `to`. Damage is applied here,
// through damageEnemy. `damage` is the amount passed to damageEnemy (12, or 24 for a head hit); a
// heavy's body hit is then reduced by damageEnemy itself.
export interface TurretEvent {
  type: 'shot';
  from: Vec3;
  to: Vec3;
  hitEnemy: Enemy | null;
  damage: number;
  head: boolean;
  // True when this shot killed hitEnemy. The caller credits the player's kill from this flag.
  killed: boolean;
}

export function createTurret(p: Vec2, yaw: number): Turret {
  return { pos: { x: p.x, y: SENTRY_HEIGHT, z: p.z }, yaw, fireT: 0, t: TURRET_TIME };
}

// Tries clear ground at 8, 6, 4 and 2 m ahead of the aim point, in that order (legacy useKillstreak).
// groundAim(dist) gives the ground point dist metres along the aim. A null isOpen means no clearance
// check is available, so placement fails and the caller keeps the killstreak.
export function placeSentry(
  groundAim: (dist: number) => Vec2,
  isOpen: OpenPredicate | null,
  yaw: number,
): PlaceResult {
  if (isOpen === null) return { placed: false };
  for (const dist of SENTRY_PLACE_DISTANCES) {
    const p = groundAim(dist);
    if (isOpen(p.x, p.z, SENTRY_OPEN_R)) {
      return { placed: true, turret: createTurret(p, yaw) };
    }
  }
  return { placed: false };
}

// Advances every turret by dt. Turrets whose life runs out are removed from the array (in place)
// without firing. Returns the shots fired this step, in turret order.
export function stepTurrets(
  turrets: Turret[],
  enemies: readonly Enemy[],
  world: CollisionWorld,
  smokes: readonly SmokeZone[],
  rng: Rng,
  dt: number,
): TurretEvent[] {
  for (let i = turrets.length - 1; i >= 0; i -= 1) {
    const tu = turrets[i];
    if (tu === undefined) continue;
    tu.t -= dt;
    if (tu.t <= 0) turrets.splice(i, 1);
  }

  const events: TurretEvent[] = [];
  for (const tu of turrets) {
    tu.fireT -= dt;
    const target = pickTarget(tu, enemies, world, smokes);
    if (target === null) continue;

    const want = Math.atan2(target.pos.x - tu.pos.x, target.pos.z - tu.pos.z);
    tu.yaw += wrapAngle(want - tu.yaw) * Math.min(1, dt * SENTRY_TURN_RATE);
    if (tu.fireT > 0 || Math.abs(wrapAngle(want - tu.yaw)) >= SENTRY_AIM_TOL) continue;

    tu.fireT = SENTRY_FIRE_INTERVAL;
    events.push(fireShot(tu, target, enemies, world, rng));
  }
  return events;
}

// Nearest living enemy within SENTRY_RANGE with a clear line of sight and no smoke in the way.
// Port of the target loop in updTurrets (the 40 m test is on squared distance, as in the legacy).
function pickTarget(
  tu: Turret,
  enemies: readonly Enemy[],
  world: CollisionWorld,
  smokes: readonly SmokeZone[],
): Enemy | null {
  let best: Enemy | null = null;
  let bestD2 = SENTRY_RANGE * SENTRY_RANGE;
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = e.pos.x - tu.pos.x;
    const dz = e.pos.z - tu.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= bestD2) continue;
    const eye: Vec3 = { x: e.pos.x, y: EYE_HEIGHT, z: e.pos.z };
    if (!hasLineOfSight(tu.pos, eye, world) || smokeBlocks(tu.pos, eye, smokes)) continue;
    best = e;
    bestD2 = d2;
  }
  return best;
}

// One shot at target: aim at the target's eye height, add spread, then take the nearer of wall and hit.
function fireShot(
  tu: Turret,
  target: Enemy,
  enemies: readonly Enemy[],
  world: CollisionWorld,
  rng: Rng,
): TurretEvent {
  const aimDy = EYE_HEIGHT - tu.pos.y;
  const ax = target.pos.x - tu.pos.x;
  const az = target.pos.z - tu.pos.z;
  const len = Math.hypot(ax, aimDy, az);
  const dir: Vec3 = { x: ax / len, y: aimDy / len, z: az / len };
  dir.x += (rng.next() - 0.5) * SENTRY_SPREAD;
  dir.z += (rng.next() - 0.5) * SENTRY_SPREAD;
  const dlen = Math.hypot(dir.x, dir.y, dir.z);
  dir.x /= dlen;
  dir.y /= dlen;
  dir.z /= dlen;

  const wall = world.raycast(tu.pos, dir, SENTRY_WALL_RANGE)?.t ?? SENTRY_WALL_RANGE;
  const hit = nearestEnemyHit(tu.pos, dir, wall, enemies);
  const end = hit === null ? wall : hit.t;
  const from = along(tu.pos, dir, SENTRY_MUZZLE);
  const to = along(tu.pos, dir, Math.max(0.9, end));

  if (hit === null) {
    return { type: 'shot', from, to, hitEnemy: null, damage: 0, head: false, killed: false };
  }
  const damage = SENTRY_DAMAGE * (hit.head ? 2 : 1);
  const result = damageEnemy(hit.enemy, damage, hit.head, 'player');
  return {
    type: 'shot',
    from,
    to,
    hitEnemy: hit.enemy,
    damage,
    head: hit.head,
    killed: result.killed,
  };
}

function along(o: Vec3, dir: Vec3, t: number): Vec3 {
  return { x: o.x + dir.x * t, y: o.y + dir.y * t, z: o.z + dir.z * t };
}

// Signed angle difference in (-PI, PI].
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
