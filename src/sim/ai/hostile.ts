import type { Vec2, Vec3 } from '../../core/math';
import { ENEMY_DEFS } from '../../content/enemies';
import type { AiEvent, AiWorld, Enemy } from '../entities';
import { findCover } from './cover';
import { visibleTarget, type Sighting } from './perception';
import { goTo, handleStuck } from './movement';

// Numbers from legacy updEnemy and its helpers (index.html:2212-2345). Distances in metres.
const SHARE_RANGE = 18; // shareIntel radius (index.html:3263-3268)
const UNSEEN_LIMIT = 4; // seconds unseen before engaged clears (index.html:2276)
const COVER_HP_FRACTION = 0.45;
const COVER_TIME = 6;
const COVER_REACH = 0.8;
const HOME_LEASH_SQ = 2.25; // guards return when more than 1.5 m from home
const REACH_SQ = 2.25; // lastSeen cleared within 1.5 m
const GUARD_SPEED = 0.8;
const HUNT_SPEED = 0.9;
const SNIPER_NEAR = 28;
const SNIPER_FAR = 40;
const SNIPER_BACK = 6;
const FLANK_RANGE = 9; // flankers engage from 9 m and swing to the side by 9 m
const PUSH_RANGE = 16;
const HEAVY_PUSH_RANGE = 9;
const BACK_RANGE = 7;
const BACK_STEP = 4;
const BACK_SPEED = 0.8;
const STRAFE_STEP = 4;
const STRAFE_SPEED = 0.55;
const STRAFE_FLIP_MIN = 1.2;
const STRAFE_FLIP_RANGE = 1.6;
const GREN_MIN_DIST = 5;
const GREN_MAX_DIST = 24;
const GREN_COOL_MIN = 9;
const GREN_COOL_RANGE = 3;
const GREN_THROW_Y = 1.5;
const FIRE_MIN_SCALE = 0.8; // fire interval scaled by 0.8..1.2
const FIRE_SCALE_RANGE = 0.4;
const SPOT_DELAY_MIN = 0.35;
const SPOT_DELAY_RANGE = 0.35;
const SEPARATION = 0.9;
const SEPARATION_RATE = 6;
const BODY_R = 0.4;
const KICK_DECAY = 8;
const CROUCH_RATE = 7;
const CROUCH_REACH = 0.9;
const PLAYER_AIM_FRACTION = 0.6; // player chest: 0.6 of eye height
const OPERATOR_AIM_Y = 0.95;
const SPREAD_MOVE_TARGET = 0.025;
const SPREAD_PER_METRE = 0.0022;
const SPREAD_MOVE_SELF = 0.03;
// goTo result meaning no move was attempted (legacy mv = -1).
const NO_MOVE = -1;

// One AI tick for one hostile. Mutates e only (plus shareIntel, which sets state and lastSeen on
// other hostiles as the legacy squad alert did) and reads w. Returns the events it produced.
export function stepHostile(e: Enemy, w: AiWorld, dt: number): AiEvent[] {
  const events: AiEvent[] = [];
  if (!e.alive) {
    e.deathT -= dt;
    return events;
  }
  const def = ENEMY_DEFS[e.kind];

  e.fireT -= dt;
  e.blind -= dt;
  e.coverT -= dt;
  e.grenT -= dt;
  e.spot -= dt;
  e.unstuck -= dt;
  e.flinchT -= dt;
  if (e.coverT <= 0) e.cover = null;

  const sight = visibleTarget(e, w);
  if (sight !== null) {
    e.state = 'hunt';
    setLast(e, sight.pos.x, sight.pos.z);
    e.unseenT = 0;
    if (!e.engaged) {
      e.engaged = true;
      e.fireT = Math.max(e.fireT, SPOT_DELAY_MIN + w.rng.next() * SPOT_DELAY_RANGE);
      events.push({ type: 'spotted', by: e, target: sight.target });
      shareIntel(e, { x: sight.pos.x, z: sight.pos.z }, w.enemies);
    }
  } else if (e.engaged) {
    e.unseenT += dt;
    if (e.unseenT > UNSEEN_LIMIT) e.engaged = false;
  }

  const dx = sight !== null ? sight.pos.x - e.pos.x : 0;
  const dz = sight !== null ? sight.pos.z - e.pos.z : 0;
  const dd = sight !== null ? Math.max(0.01, Math.hypot(dx, dz)) : 0;
  const speed = def.speed;
  let mv = NO_MOVE;

  if (sight !== null) {
    mv = engage(e, sight, dx, dz, dd, w, dt, events);
  } else if (e.state === 'guard') {
    if (e.home !== null && sqDist(e.pos, e.home) > HOME_LEASH_SQ) {
      mv = goTo(e, e.home.x, e.home.z, speed * GUARD_SPEED, dt, w);
    }
  } else {
    mv = hunt(e, w, dt);
  }

  if (sight !== null) e.yaw = Math.atan2(dx, dz);
  handleStuck(e, mv, speed, dt, w);
  e.moving = mv > 0.001;

  if (sight !== null && e.fireT <= 0 && e.blind <= 0) {
    e.fireT = def.fire * (FIRE_MIN_SCALE + w.rng.next() * FIRE_SCALE_RANGE);
    // Only the player's movement widens a shot on the player (legacy enemyShoot, index.html:2225).
    const targetMoving = sight.target.kind === 'player' && w.player.moving;
    events.push({
      type: 'shoot',
      shooter: e,
      target: sight.target,
      aim: aimPoint(sight, w),
      spread: shotSpread(e, dd, targetMoving),
    });
    e.kick = 1;
  }

  // Crouch toward 1 while hiding in cover, otherwise stand.
  const hiding =
    e.cover !== null && e.coverT > 0 && Math.hypot(e.cover.x - e.pos.x, e.cover.z - e.pos.z) < CROUCH_REACH;
  e.crouch += ((hiding ? 1 : 0) - e.crouch) * Math.min(1, dt * CROUCH_RATE);

  // Keep 0.9 m between hostiles so squads do not stack on one spot.
  for (const o of w.enemies) {
    if (o === e || !o.alive) continue;
    const sx = e.pos.x - o.pos.x;
    const sz = e.pos.z - o.pos.z;
    const sd = Math.hypot(sx, sz);
    if (sd > 0.01 && sd < SEPARATION) {
      const push = (SEPARATION - sd) * 0.5 * Math.min(1, dt * SEPARATION_RATE);
      e.pos.x += (sx / sd) * push;
      e.pos.z += (sz / sd) * push;
    }
  }
  w.collision.pushOut(e.pos, BODY_R);
  e.kick = Math.max(0, e.kick - dt * KICK_DECAY);
  return events;
}

// Squad alert: hostiles within 18 m of src go to hunt and head for t (legacy shareIntel, index.html:3263-3268).
export function shareIntel(src: Enemy, t: Vec2, enemies: readonly Enemy[]): void {
  for (const o of enemies) {
    if (o === src || !o.alive) continue;
    if (sqDist(o.pos, src.pos) < SHARE_RANGE * SHARE_RANGE) {
      o.state = 'hunt';
      setLast(o, t.x, t.z);
    }
  }
}

// Alerts living hostiles within r of (x, z) (legacy alertEnemies, index.html:2216-2221). Used by
// player actions that make noise or melee, which the combat side calls.
export function alertEnemies(enemies: readonly Enemy[], x: number, z: number, r: number): void {
  for (const e of enemies) {
    if (!e.alive) continue;
    if (sqDist(e.pos, { x, z }) < r * r) {
      e.state = 'hunt';
      setLast(e, x, z);
    }
  }
}

// Spread added to the aim direction before the ray test (legacy enemyShoot, index.html:2224). The
// result travels on the shoot event as `spread`, and resolveEnemyShot applies that value unchanged.
// dd is the horizontal distance from shooter to target; targetMoving is the target's moving flag.
export function shotSpread(shooter: Enemy, dd: number, targetMoving: boolean): number {
  return (
    ENEMY_DEFS[shooter.kind].acc +
    dd * SPREAD_PER_METRE +
    (targetMoving ? SPREAD_MOVE_TARGET : 0) +
    (shooter.moving ? SPREAD_MOVE_SELF : 0)
  );
}

// Movement and grenades while a target is visible. Returns the move result for handleStuck.
function engage(
  e: Enemy,
  s: Sighting,
  dx: number,
  dz: number,
  dd: number,
  w: AiWorld,
  dt: number,
  events: AiEvent[],
): number {
  const def = ENEMY_DEFS[e.kind];
  const speed = def.speed;
  const tx = s.pos.x;
  const tz = s.pos.z;
  let mv = NO_MOVE;

  if (e.hp < e.maxHp * COVER_HP_FRACTION && e.coverT <= 0 && !def.sniper) {
    e.cover = findCover(e, tx, s.eyeY, tz, w);
    e.coverT = COVER_TIME;
  }

  if (e.cover !== null && e.coverT > 0) {
    if (Math.hypot(e.cover.x - e.pos.x, e.cover.z - e.pos.z) > COVER_REACH) {
      mv = goTo(e, e.cover.x, e.cover.z, speed, dt, w);
    }
  } else if (def.sniper) {
    // Hold a 28-40 m band: back off inside it, creep up outside it.
    if (dd < SNIPER_NEAR) {
      mv = goTo(e, e.pos.x - (dx / dd) * SNIPER_BACK, e.pos.z - (dz / dd) * SNIPER_BACK, speed, dt, w);
    } else if (dd > SNIPER_FAR) {
      mv = goTo(e, tx, tz, speed, dt, w);
    }
  } else if (e.role === 'flank' && s.target.kind === 'player' && dd > FLANK_RANGE) {
    // Flankers swing wide to hit the player from the side.
    const px = -dz / dd;
    const pz = dx / dd;
    mv = goTo(
      e,
      w.player.pos.x + px * e.flankSide * FLANK_RANGE,
      w.player.pos.z + pz * e.flankSide * FLANK_RANGE,
      speed,
      dt,
      w,
    );
  } else if ((def.heavy && dd > HEAVY_PUSH_RANGE) || dd > PUSH_RANGE) {
    // Heavies push in closer behind their shield.
    mv = goTo(e, tx, tz, speed, dt, w);
  } else if (dd < BACK_RANGE) {
    mv = goTo(e, e.pos.x - (dx / dd) * BACK_STEP, e.pos.z - (dz / dd) * BACK_STEP, speed * BACK_SPEED, dt, w);
  } else {
    e.strafeT -= dt;
    if (e.strafeT <= 0) {
      e.strafeDir = e.strafeDir === 1 ? -1 : 1;
      e.strafeT = STRAFE_FLIP_MIN + w.rng.next() * STRAFE_FLIP_RANGE;
    }
    mv = goTo(
      e,
      e.pos.x - (dz / dd) * e.strafeDir * STRAFE_STEP,
      e.pos.z + (dx / dd) * e.strafeDir * STRAFE_STEP,
      speed * STRAFE_SPEED,
      dt,
      w,
    );
  }

  if (
    def.grenadier &&
    e.grenT <= 0 &&
    dd > GREN_MIN_DIST &&
    dd < GREN_MAX_DIST &&
    s.target.kind === 'player'
  ) {
    events.push({ type: 'grenade', from: { x: e.pos.x, y: GREN_THROW_Y, z: e.pos.z }, to: { x: tx, z: tz } });
    e.grenT = GREN_COOL_MIN + w.rng.next() * GREN_COOL_RANGE;
  }
  return mv;
}

// Walk toward the last sighting, or toward the nearest open zone with this hostile's offset
// (legacy updEnemy hunt branch, index.html:2318-2326 and 2296-2305 for the target choice).
function hunt(e: Enemy, w: AiWorld, dt: number): number {
  let tgt: Vec2 | null = e.lastSeen;
  if (tgt !== null && sqDist(e.pos, tgt) < REACH_SQ) {
    e.lastSeen = null;
    tgt = null;
  }
  if (tgt === null) {
    const zone = openZoneFrom(e.pos.x, e.pos.z, w.zones);
    if (zone !== null) {
      tgt = { x: zone.x + e.gx, z: zone.z + e.gz };
    } else if (w.player.alive) {
      tgt = { x: w.player.pos.x, z: w.player.pos.z };
    } else {
      tgt = { x: e.pos.x, z: e.pos.z };
    }
  }
  return goTo(e, tgt.x, tgt.z, ENEMY_DEFS[e.kind].speed * HUNT_SPEED, dt, w);
}

function aimPoint(s: Sighting, w: AiWorld): Vec3 {
  if (s.target.kind === 'player') {
    return { x: s.pos.x, y: s.pos.y + w.player.eyeHeight * PLAYER_AIM_FRACTION, z: s.pos.z };
  }
  return { x: s.pos.x, y: OPERATOR_AIM_Y, z: s.pos.z };
}

function openZoneFrom(x: number, z: number, zones: AiWorld['zones']): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const zn of zones) {
    if (zn.captured) continue;
    const dd = sqDist({ x, z }, { x: zn.x, z: zn.z });
    if (dd < bestD) {
      bestD = dd;
      best = { x: zn.x, z: zn.z };
    }
  }
  return best;
}

function setLast(e: Enemy, x: number, z: number): void {
  if (e.lastSeen !== null) {
    e.lastSeen.x = x;
    e.lastSeen.z = z;
  } else {
    e.lastSeen = { x, z };
  }
}

function sqDist(a: Vec2, b: Vec2): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}
