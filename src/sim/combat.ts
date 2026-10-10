import type { Vec3 } from '../core/math';
import type { Rng } from '../core/rng';
import type { DifficultyDef } from '../content/difficulty';
import { ENEMY_DEFS } from '../content/enemies';
import type { AiEvent, Enemy } from './entities';
import type { CollisionWorld } from './collision';

// Enemy and hostile-facing combat resolution, ported from the legacy game.

// index.html:2223 (eye height of a shooter, metres). Shared with the sim so shot origins match.
export const EYE_HEIGHT = 1.5;
// index.html:2226 (player body centre is at feet + eyeCur * 0.6; operators at 0.95). The same
// fractions aim the shot in ai/hostile.ts, so aim and hit test agree.
export const PLAYER_BODY_FRACTION = 0.6;
export const OPERATOR_BODY_Y = 0.95;
// index.html:2226 and 2233 (body sphere radius).
const BODY_R = 0.42;
// index.html:2222-2243 (shot range cap).
const SHOT_RANGE = 300;
// index.html:2237 (damage falloff beyond 30 m).
const FALLOFF_RANGE = 30;
const FALLOFF_MULT = 0.7;
// index.html:2242 (tracer chance for non-snipers).
const TRACER_CHANCE = 0.3;
// index.html:1857-1866 (enemy hit spheres: body and head).
const HIT_BODY_Y = 0.95;
const HIT_HEAD_Y = 1.6;
const HIT_BODY_R = 0.42;
const HIT_HEAD_R = 0.2;
const ENEMY_DEATH_T = 4;
const FLINCH_T = 0.12;
// Score for a player kill and the headshot bonus (index.html:2531-2535).
export const KILL_SCORE = 100;
export const HEADSHOT_BONUS = 50;

export interface ShotResult {
  hit: boolean;
  // Damage to the target, already scaled by difficulty and range. Zero on a miss.
  damage: number;
  // End of the shot in world space: the body hit point, or the wall hit, or 300 m out.
  end: Vec3;
  tracer: boolean;
}

// Ray against a sphere; d must be normalised. Returns the entry distance, or Infinity on a miss.
// Port of index.html:854-864.
export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const lx = c.x - o.x;
  const ly = c.y - o.y;
  const lz = c.z - o.z;
  const tca = lx * d.x + ly * d.y + lz * d.z;
  const d2s = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2s > r2) return Infinity;
  const th = Math.sqrt(r2 - d2s);
  let t = tca - th;
  if (t < 0) t = tca + th;
  return t < 0 ? Infinity : t;
}

// Nearest living enemy along a normalised ray, up to maxT. A head hit is preferred when its sphere is nearer.
// Port of index.html:1856-1866.
export function nearestEnemyHit(
  o: Vec3,
  dir: Vec3,
  maxT: number,
  enemies: readonly Enemy[],
): { enemy: Enemy; head: boolean; t: number } | null {
  let best: { enemy: Enemy; head: boolean; t: number } | null = null;
  let bt = maxT;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    // Big hostiles (the juggernaut) have proportionally bigger hit spheres.
    const sc = ENEMY_DEFS[enemy.kind].scale;
    const tb = raySphere(o, dir, { x: enemy.pos.x, y: HIT_BODY_Y * sc, z: enemy.pos.z }, HIT_BODY_R * sc);
    const th = raySphere(o, dir, { x: enemy.pos.x, y: HIT_HEAD_Y * sc, z: enemy.pos.z }, HIT_HEAD_R * sc);
    const t = Math.min(tb, th);
    if (t < bt) {
      bt = t;
      best = { enemy, head: th <= tb, t };
    }
  }
  return best;
}

// Resolves one enemy shot. Returns what happened; applying damage is the caller's job.
// ev.spread is the cone value from shotSpread (the same number the AI attached to the event).
// eyeY is the player's current eye height (legacy P.eyeCur); it is ignored for operator targets.
// Port of index.html:2222-2243 (enemyShoot), with RNG consumption in the legacy order.
export function resolveEnemyShot(
  shooter: Enemy,
  ev: Pick<Extract<AiEvent, { type: 'shoot' }>, 'target' | 'aim' | 'spread'>,
  targetPos: Vec3,
  isPlayerTarget: boolean,
  world: CollisionWorld,
  rng: Rng,
  difficulty: DifficultyDef,
  eyeY: number,
): ShotResult {
  const def = ENEMY_DEFS[shooter.kind];
  const eye: Vec3 = { x: shooter.pos.x, y: EYE_HEIGHT, z: shooter.pos.z };
  const by = isPlayerTarget ? targetPos.y + eyeY * PLAYER_BODY_FRACTION : OPERATOR_BODY_Y;
  const dd = Math.hypot(targetPos.x - shooter.pos.x, targetPos.z - shooter.pos.z);

  const ax = ev.aim.x - eye.x;
  const ay = ev.aim.y - eye.y;
  const az = ev.aim.z - eye.z;
  const len = Math.hypot(ax, ay, az);
  const dir: Vec3 = { x: ax / len, y: ay / len, z: az / len };

  const spread = ev.spread;
  dir.x += (rng.next() * 2 - 1) * spread;
  dir.y += (rng.next() * 2 - 1) * spread;
  const dlen = Math.hypot(dir.x, dir.y, dir.z);
  dir.x /= dlen;
  dir.y /= dlen;
  dir.z /= dlen;

  const wallT = world.raycast(eye, dir, SHOT_RANGE)?.t ?? Infinity;
  const bodyT = raySphere(eye, dir, { x: targetPos.x, y: by, z: targetPos.z }, BODY_R);
  const hit = bodyT < wallT;

  let damage = 0;
  let endT: number;
  if (hit) {
    endT = bodyT;
    const falloff = dd < FALLOFF_RANGE ? 1 : FALLOFF_MULT;
    damage = def.dmg * difficulty.dmg * falloff;
  } else {
    endT = Math.min(wallT, SHOT_RANGE);
  }

  const tracer = def.sniper || rng.next() < TRACER_CHANCE;
  const end: Vec3 = {
    x: eye.x + dir.x * endT,
    y: eye.y + dir.y * endT,
    z: eye.z + dir.z * endT,
  };
  return { hit, damage, end, tracer };
}

export interface EnemyDamageResult {
  killed: boolean;
  // Score for the player's kill (100, plus 50 for a headshot). Zero for operator kills and non-kills.
  scoreDelta: number;
  // How much to subtract from the enemy ticket pool: 1 on a kill, otherwise 0.
  ticketDelta: number;
  // True when the hit was to the head (reported whether or not it killed).
  headshot: boolean;
}

// Applies damage to a hostile. Armoured kinds take a share of non-head damage: heavies 60% (index.html:2521),
// juggernauts 45%.
// Streak, multi-kill and feed logic stays with the caller; this returns the data it needs.
export function damageEnemy(
  e: Enemy,
  dmg: number,
  head: boolean,
  by: 'player' | 'operator',
): EnemyDamageResult {
  if (!e.alive) return { killed: false, scoreDelta: 0, ticketDelta: 0, headshot: false };
  const scaled = head ? dmg : dmg * ENEMY_DEFS[e.kind].armor;
  e.hp -= scaled;
  e.flinchT = FLINCH_T;
  e.state = 'hunt';
  if (e.hp > 0) return { killed: false, scoreDelta: 0, ticketDelta: 0, headshot: head };
  e.alive = false;
  e.deathT = ENEMY_DEATH_T;
  const scoreDelta = by === 'player' ? KILL_SCORE + (head ? HEADSHOT_BONUS : 0) : 0;
  return { killed: true, scoreDelta, ticketDelta: 1, headshot: head };
}
