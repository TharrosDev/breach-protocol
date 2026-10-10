import type { Vec3 } from '../core/math';
import type { Enemy } from './entities';
import { damageEnemy } from './combat';

// Claymore proximity mines. A mine arms a moment after it is placed, then blows when a living hostile comes
// within the trigger radius. The blast hurts hostiles and the player alike (less for the player).

// Seconds before a placed mine arms.
export const MINE_ARM_TIME = 1;
// A hostile this close (m, XZ) sets the mine off.
export const MINE_TRIGGER_RADIUS = 2.6;
// Blast radius (m, XZ) and damage at the centre (linear falloff).
export const MINE_BLAST_RADIUS = 5;
export const MINE_ENEMY_DAMAGE = 150;
export const MINE_PLAYER_DAMAGE = 45;
// How far in front of the player the mine is set down (m).
export const MINE_PLACE_DIST = 1.2;
const MINE_BODY_R = 0.3;

export interface Mine {
  pos: Vec3;
  // Seconds until armed. The mine can trigger once this reaches zero.
  armT: number;
  // Direction the mine faces (yaw from +z), the player's aim when it was set. Used by the model.
  yaw?: number;
}

export interface MineBlast {
  at: Vec3;
  enemyKills: Enemy[];
  playerDamage: number;
}

// Sets a mine down just ahead of the feet along the horizontal aim, or at the feet when `isFree` rejects that spot.
export function placeMine(
  feet: Vec3,
  aim: Vec3,
  isFree: (x: number, z: number, r: number) => boolean = () => true,
): Mine {
  const h = Math.hypot(aim.x, aim.z);
  const nx = h > 1e-6 ? aim.x / h : 0;
  const nz = h > 1e-6 ? aim.z / h : 1;
  const x = feet.x + nx * MINE_PLACE_DIST;
  const z = feet.z + nz * MINE_PLACE_DIST;
  const free = isFree(x, z, MINE_BODY_R);
  return {
    pos: { x: free ? x : feet.x, y: 0, z: free ? z : feet.z },
    armT: MINE_ARM_TIME,
    yaw: Math.atan2(nx, nz),
  };
}

// Ages the mines and detonates the ones a hostile has walked up to. Triggered mines are removed from the list.
// Damage to hostiles is applied here; the player's damage is returned for the caller.
export function stepMines(
  mines: Mine[],
  dt: number,
  enemies: readonly Enemy[],
  playerPos: Vec3,
  playerAlive: boolean,
): MineBlast[] {
  const blasts: MineBlast[] = [];
  for (let i = mines.length - 1; i >= 0; i--) {
    const m = mines[i];
    if (m === undefined) continue;
    m.armT = Math.max(0, m.armT - dt);
    if (m.armT > 0) continue;
    const tripped = enemies.some(
      (e) => e.alive && Math.hypot(e.pos.x - m.pos.x, e.pos.z - m.pos.z) < MINE_TRIGGER_RADIUS,
    );
    if (!tripped) continue;
    mines.splice(i, 1);
    const enemyKills: Enemy[] = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - m.pos.x, e.pos.z - m.pos.z);
      if (d >= MINE_BLAST_RADIUS) continue;
      if (damageEnemy(e, MINE_ENEMY_DAMAGE * (1 - d / MINE_BLAST_RADIUS), false, 'player').killed) {
        enemyKills.push(e);
      }
    }
    const dp = Math.hypot(playerPos.x - m.pos.x, playerPos.z - m.pos.z);
    const playerDamage =
      playerAlive && dp < MINE_BLAST_RADIUS ? MINE_PLAYER_DAMAGE * (1 - dp / MINE_BLAST_RADIUS) : 0;
    blasts.push({ at: { x: m.pos.x, y: 0.3, z: m.pos.z }, enemyKills, playerDamage });
  }
  return blasts;
}
