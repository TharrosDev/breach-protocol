import type { Vec2, Vec3 } from '../core/math';
import type { Rng } from '../core/rng';
import {
  AIRSTRIKE_BLASTS,
  AIRSTRIKE_BLAST_Y,
  AIRSTRIKE_ENEMY_DAMAGE,
  AIRSTRIKE_FIRST_MS,
  AIRSTRIKE_GAP_MS,
  AIRSTRIKE_PLAYER_DAMAGE,
  AIRSTRIKE_RADIUS,
  AIRSTRIKE_SPREAD,
} from '../content/killstreaks';
import { damageEnemy } from './combat';
import type { CollisionWorld } from './collision';
import type { Enemy } from './entities';
import { hasLineOfSight } from './killstreaks';

// Airstrike, ported from the legacy callAirstrike and explodeAt (index.html:1589-1617).
// Smoke does not block blasts (the legacy explosion checks only the line of sight).

export interface AirstrikeState {
  // Aim point on the ground.
  aim: Vec2;
  // Milliseconds since the strike was called in.
  elapsedMs: number;
  // Blasts fired so far, 0 to AIRSTRIKE_BLASTS.
  fired: number;
  // True once every blast has fired.
  done: boolean;
}

export interface AirstrikeBlast {
  at: Vec3;
  radius: number;
}

// What one step produced. The caller draws the blasts and applies playerDamage to the player.
export interface AirstrikeStep {
  blasts: AirstrikeBlast[];
  // Total falloff damage to the player from this step's blasts. Zero when playerPos is null.
  playerDamage: number;
  // Enemies this step's blasts killed. Each kill counts for the player, as in the legacy.
  enemyKills: Enemy[];
}

// Tiny slack so a due time that lands exactly on a step boundary still fires.
const TIME_EPS = 1e-6;
// Centre height of a hostile's body (legacy explodeAt: v3(e.pos.x, 1, e.pos.z)).
const ENEMY_CENTRE_Y = 1;
// Centre height of the player body above the feet (legacy explodeAt: P.pos.y + 1).
const PLAYER_CENTRE_Y = 1;

export function createAirstrike(aim: Vec2): AirstrikeState {
  return { aim: { x: aim.x, z: aim.z }, elapsedMs: 0, fired: 0, done: false };
}

// Advances the strike by dt seconds. Blasts fire as they come due: blast k at 300 ms + k * 260 ms.
// Each blast lands at the aim point plus a random offset in a 12 m square, drawn when it fires.
// playerPos is the player's feet position, or null when the player is down.
export function stepAirstrike(
  state: AirstrikeState,
  dt: number,
  enemies: readonly Enemy[],
  world: CollisionWorld,
  rng: Rng,
  playerPos: Vec3 | null,
): AirstrikeStep {
  const out: AirstrikeStep = { blasts: [], playerDamage: 0, enemyKills: [] };
  if (state.done) return out;

  state.elapsedMs += dt * 1000;
  while (state.fired < AIRSTRIKE_BLASTS && state.elapsedMs + TIME_EPS >= dueMs(state.fired)) {
    const x = state.aim.x + (rng.next() - 0.5) * AIRSTRIKE_SPREAD;
    const z = state.aim.z + (rng.next() - 0.5) * AIRSTRIKE_SPREAD;
    const at: Vec3 = { x, y: AIRSTRIKE_BLAST_Y, z };
    state.fired += 1;
    out.blasts.push({ at, radius: AIRSTRIKE_RADIUS });
    applyBlast(at, enemies, world, playerPos, out);
  }
  if (state.fired >= AIRSTRIKE_BLASTS) state.done = true;
  return out;
}

function dueMs(k: number): number {
  return AIRSTRIKE_FIRST_MS + k * AIRSTRIKE_GAP_MS;
}

// Damage to hostiles and the player inside one blast's radius, with a clear line of sight.
// Damage falls off linearly: full at the centre, zero at the radius.
function applyBlast(
  at: Vec3,
  enemies: readonly Enemy[],
  world: CollisionWorld,
  playerPos: Vec3 | null,
  out: AirstrikeStep,
): void {
  for (const e of enemies) {
    if (!e.alive) continue;
    const c: Vec3 = { x: e.pos.x, y: ENEMY_CENTRE_Y, z: e.pos.z };
    const dd = distance3(at, c);
    if (dd >= AIRSTRIKE_RADIUS || !hasLineOfSight(at, c, world)) continue;
    const result = damageEnemy(e, AIRSTRIKE_ENEMY_DAMAGE * (1 - dd / AIRSTRIKE_RADIUS), false, 'player');
    if (result.killed) out.enemyKills.push(e);
  }

  if (playerPos === null) return;
  const pc: Vec3 = { x: playerPos.x, y: playerPos.y + PLAYER_CENTRE_Y, z: playerPos.z };
  const dd = distance3(at, pc);
  if (dd < AIRSTRIKE_RADIUS && hasLineOfSight(at, pc, world)) {
    out.playerDamage += AIRSTRIKE_PLAYER_DAMAGE * (1 - dd / AIRSTRIKE_RADIUS);
  }
}

function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
