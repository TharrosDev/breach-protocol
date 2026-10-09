import type { Vec3 } from '../core/math';
import type { BoxId, CollisionWorld } from './collision';
import type { Enemy } from './entities';
import { damageEnemy } from './combat';

// Breach charges on reinforced walls. Ported from the legacy game: aimBreakable (index.html:2053-2057),
// plantCharge (2058-2068), updPlant (2069-2092) and breakWall (2093-2105). Charges are two per life;
// resupply refills them (resupply.ts).

// index.html:2058-2068 (two charges, reach 3.2 m along the aim).
export const BREACH_CHARGES = 2;
export const PLANT_REACH = 3.2;
// index.html:2069-2092 (the charge arms for 2.2 s, then the blast radius is 4.5 m).
export const ARM_TIME = 2.2;
export const BLAST_RADIUS = 4.5;
// index.html:2083-2089 (110 to hostiles at the centre, 60 to the player at the centre, both with linear falloff).
export const ENEMY_BLAST_DMG = 110;
export const PLAYER_BLAST_DMG = 60;

export interface BreachPlant {
  box: BoxId;
  // Point on the box where the charge sits.
  point: Vec3;
  // Seconds until the charge detonates.
  t: number;
}

export interface BreachState {
  charges: number;
  plant: BreachPlant | null;
}

export function createBreach(): BreachState {
  return { charges: BREACH_CHARGES, plant: null };
}

// Plants a charge on the first breakable box the aim ray hits within PLANT_REACH. Needs a free charge and no
// charge already armed. The caller checks that the player is alive (legacy plantCharge checks P.alive).
// playerEye is the eye position and aimDir a normalised direction.
export function plantBreach(
  state: BreachState,
  playerEye: Vec3,
  aimDir: Vec3,
  world: CollisionWorld,
): { planted: boolean; point?: Vec3; box?: BoxId } {
  if (state.plant !== null || state.charges <= 0) return { planted: false };
  const hit = world.raycast(playerEye, aimDir, PLANT_REACH, { onlyBreakable: true });
  if (hit === null) return { planted: false };
  const point: Vec3 = {
    x: playerEye.x + aimDir.x * hit.t,
    y: playerEye.y + aimDir.y * hit.t,
    z: playerEye.z + aimDir.z * hit.t,
  };
  state.charges -= 1;
  state.plant = { box: hit.id, point, t: ARM_TIME };
  return { planted: true, point, box: hit.id };
}

export interface BreachStep {
  exploded: boolean;
  // The box removed from the world by this explosion. When set, the caller must rebuild the nav grid.
  brokenBox?: BoxId;
  // Enemies this explosion killed.
  enemyKills: Enemy[];
  // Damage to the player (0 when none). The caller applies it with damagePlayer.
  playerDamage: number;
}

// Ages the armed charge by dt. On detonation: removes the box from world, damages living enemies within
// 4.5 m (XZ, linear falloff, applied here) and returns the player's damage for the caller to apply.
// Port of updPlant (index.html:2069-2092) and breakWall (2093-2105).
export function stepBreach(
  state: BreachState,
  dt: number,
  world: CollisionWorld,
  enemies: Enemy[],
  playerPos: Vec3,
): BreachStep {
  const plant = state.plant;
  if (plant === null) return { exploded: false, enemyKills: [], playerDamage: 0 };
  plant.t -= dt;
  if (plant.t > 0) return { exploded: false, enemyKills: [], playerDamage: 0 };

  state.plant = null;
  world.remove(plant.box);

  const enemyKills: Enemy[] = [];
  for (const e of enemies) {
    if (!e.alive) continue;
    const dd = Math.hypot(e.pos.x - plant.point.x, e.pos.z - plant.point.z);
    if (dd < BLAST_RADIUS) {
      const r = damageEnemy(e, ENEMY_BLAST_DMG * (1 - dd / BLAST_RADIUS), false, 'player');
      if (r.killed) enemyKills.push(e);
    }
  }
  const dp = Math.hypot(playerPos.x - plant.point.x, playerPos.z - plant.point.z);
  const playerDamage = dp < BLAST_RADIUS ? PLAYER_BLAST_DMG * (1 - dp / BLAST_RADIUS) : 0;

  return { exploded: true, brokenBox: plant.box, enemyKills, playerDamage };
}
