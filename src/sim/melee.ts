import type { Vec2 } from '../core/math';
import type { Enemy } from './entities';

// Melee knife (legacy melee, index.html:3243-3257; spec §1.3 WPN-08). Pure: no DOM, no three.js. The sim decides
// the strike and applies the damage; these numbers are the knife's stats.

// Reach from the player's position, in metres.
export const MELEE_RANGE = 1.7;
// The enemy must lie within this cosine of the view direction (about 57 degrees either side).
export const MELEE_CONE_COS = 0.55;
// Seconds between swings, and the swing animation time (the viewmodel thrust follows it).
export const MELEE_COOLDOWN = 0.9;
export const MELEE_TIME = 0.3;
// Damage from behind (the enemy faces the same way as the player) and from the front.
export const MELEE_DMG_BEHIND = 150;
export const MELEE_DMG_FRONT = 80;
// An enemy counts as facing the same way when its facing dotted with the player's view is above this.
const BEHIND_DOT = 0.3;
// Hostiles within this radius hear a knife swing (legacy alertEnemies(..., 8)).
export const MELEE_ALERT_RADIUS = 8;

export interface MeleeHit {
  enemy: Enemy;
  behind: boolean;
  damage: number;
}

// Every living hostile the knife reaches from `pos` when the player looks along `yaw`, with the damage each takes.
// Heavy shields are not special here: damageEnemy applies the heavy multiplier to non-head hits.
export function meleeStrike(pos: Vec2, yaw: number, enemies: readonly Enemy[]): MeleeHit[] {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const hits: MeleeHit[] = [];
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = e.pos.x - pos.x;
    const dz = e.pos.z - pos.z;
    const dd = Math.hypot(dx, dz);
    if (dd > MELEE_RANGE) continue;
    if ((dx * fx + dz * fz) / Math.max(dd, 0.01) < MELEE_CONE_COS) continue;
    // The enemy's facing is (sin yaw, cos yaw), as in hostile.ts. Facing the same way as the player means the
    // player is behind it.
    const behind = Math.sin(e.yaw) * fx + Math.cos(e.yaw) * fz > BEHIND_DOT;
    hits.push({ enemy: e, behind, damage: behind ? MELEE_DMG_BEHIND : MELEE_DMG_FRONT });
  }
  return hits;
}
