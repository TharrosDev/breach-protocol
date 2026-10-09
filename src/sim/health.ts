import type { Vec2 } from '../core/math';
import { ALLY_RESPAWN, BLEEDOUT_TIME } from '../content/tuning';
import type { Enemy, Operator } from './entities';

// Player and operator health rules ported from the legacy game.

export interface PlayerHealth {
  hp: number;
  alive: boolean;
  lastHurt: number;
  downed: boolean;
  bleedT: number;
}

// index.html:2952: passive regen cap and rate.
export const PLAYER_MAX_HP = 100;
// index.html:2952 (regen starts once more than 4 s have passed since the last hit).
export const REGEN_DELAY = 4;
export const REGEN_RATE = 25;
// index.html:1652-1657 (revive restores 40 hp and awards 150 score).
export const REVIVE_HP = 40;
export const REVIVE_SCORE = 150;
// index.html:1629-1641 (a living operator within 18 m turns a kill into a downed state).
export const DOWN_RANGE = 18;
// index.html:1658-1679 (respawn offset from a squadmate, clearance from enemies, and open-point radius).
const OPERATOR_SPAWN_DX = 2.5;
const OPERATOR_SPAWN_DZ = -2.5;
const SPAWN_OPEN_R = 0.6;
const SPAWN_ENEMY_CLEAR = 15;

function dist2(ax: number, az: number, bx: number, bz: number): number {
  return (ax - bx) ** 2 + (az - bz) ** 2;
}

// index.html:1622-1628. Applies damage to a living player and records the hit time.
// Returns killed when hp reaches 0; the caller then calls killPlayerOrDown.
export function damagePlayer(
  p: Pick<PlayerHealth, 'hp' | 'alive' | 'lastHurt'>,
  d: number,
  time: number,
): { killed: boolean } {
  if (!p.alive || d <= 0) return { killed: false };
  p.hp -= d;
  p.lastHurt = time;
  if (p.hp > 0) return { killed: false };
  p.hp = 0;
  return { killed: true };
}

// True when a living operator stands within range (XZ) of the player. Feeds killPlayerOrDown.
export function hasNearbyOperator(
  playerPos: Vec2,
  operators: readonly Operator[],
  range = DOWN_RANGE,
): boolean {
  return operators.some((a) => a.alive && dist2(a.pos.x, a.pos.z, playerPos.x, playerPos.z) < range * range);
}

// index.html:1629-1641. Downs the player when a squadmate is nearby (bleedout starts), otherwise eliminates them.
// Mutates p. Life accounting and the respawn timer stay with the caller.
export function killPlayerOrDown(
  p: Pick<PlayerHealth, 'hp' | 'alive' | 'downed' | 'bleedT'>,
  operatorNearby: boolean,
): 'down' | 'dead' {
  p.hp = 0;
  p.alive = false;
  if (operatorNearby) {
    p.downed = true;
    p.bleedT = BLEEDOUT_TIME;
    return 'down';
  }
  p.downed = false;
  return 'dead';
}

// index.html:1652-1657. Brings a downed player back at 40 hp. Returns the score awarded.
export function revivePlayer(p: Pick<PlayerHealth, 'hp' | 'alive' | 'downed'>): { scoreDelta: number } {
  p.downed = false;
  p.alive = true;
  p.hp = REVIVE_HP;
  return { scoreDelta: REVIVE_SCORE };
}

// index.html:1658-1679. Prefers a clear spot beside the first living operator (+2.5 x, -2.5 z) that has no
// living enemy within 15 m. Otherwise picks the spawn furthest from its nearest living enemy.
// isOpen(x, z, r) is the caller's open-point test (legacy openPoint).
export function respawnSpot(
  operators: readonly Operator[],
  enemies: readonly Enemy[],
  spawns: readonly Vec2[],
  isOpen: (x: number, z: number, r: number) => boolean,
): Vec2 {
  for (const a of operators) {
    if (!a.alive) continue;
    const x = a.pos.x + OPERATOR_SPAWN_DX;
    const z = a.pos.z + OPERATOR_SPAWN_DZ;
    if (!isOpen(x, z, SPAWN_OPEN_R)) continue;
    if (enemies.some((e) => e.alive && dist2(e.pos.x, e.pos.z, x, z) < SPAWN_ENEMY_CLEAR * SPAWN_ENEMY_CLEAR))
      continue;
    return { x, z };
  }
  const first = spawns[0];
  if (first === undefined) throw new RangeError('respawnSpot() requires at least one spawn');
  let best: Vec2 = first;
  let bestD = -1;
  for (const s of spawns) {
    let md = Infinity;
    for (const e of enemies) {
      if (e.alive) md = Math.min(md, dist2(e.pos.x, e.pos.z, s.x, s.z));
    }
    if (md > bestD) {
      bestD = md;
      best = s;
    }
  }
  return { x: best.x, z: best.z };
}

// index.html:1680-1686. Applies damage to a living operator; a kill starts the respawn timer.
export function damageOperator(a: Operator, dmg: number): { killed: boolean } {
  if (!a.alive) return { killed: false };
  a.hp -= dmg;
  if (a.hp > 0) return { killed: false };
  a.alive = false;
  a.deathT = ALLY_RESPAWN;
  return { killed: true };
}

// index.html:2952. Hp after one step of passive regen. The caller checks that the player is alive.
export function passiveRegen(hp: number, dt: number, time: number, lastHurt: number): number {
  if (time - lastHurt > REGEN_DELAY && hp < PLAYER_MAX_HP) {
    return Math.min(PLAYER_MAX_HP, hp + REGEN_RATE * dt);
  }
  return hp;
}
