import type { Vec2, Vec3 } from '../core/math';
import type { Rng } from '../core/rng';
import type { CollisionWorld } from './collision';
import type { NavGrid, PathBudget } from './nav/types';
import type { EnemyKindId } from '../content/enemies';

// Plain state objects for AI entities. Render-only fields (fall, tumble, gun kick) are not here.

export interface PathState {
  path: Vec2[] | null;
  pathIdx: number;
  pathT: number;
  pathTx: number;
  pathTz: number;
  stuckT: number;
  unstuck: number;
  sideX: number;
  sideZ: number;
}

export interface Enemy extends PathState {
  kind: EnemyKindId;
  alive: boolean;
  hp: number;
  maxHp: number;
  pos: Vec2;
  yaw: number;
  state: 'guard' | 'hunt';
  home: Vec2 | null;
  lastSeen: Vec2 | null;
  sight: number;
  // flank: swings wide to the player's side. push: advances. suppress: holds a firing position and keeps the
  // player's head down, also with blind fire at the last sighting.
  role: 'flank' | 'push' | 'suppress';
  flankSide: 1 | -1;
  fireT: number;
  blind: number;
  coverT: number;
  grenT: number;
  cover: Vec2 | null;
  engaged: boolean;
  unseenT: number;
  flinchT: number;
  strafeT: number;
  strafeDir: 1 | -1;
  moving: boolean;
  phase: number;
  deathT: number;
  spot: number;
  gx: number;
  gz: number;
  kick: number;
  crouch: number;
  // Seconds until a medic may report another heal (sound cue only).
  healPing?: number;
}

export interface Operator extends PathState {
  name: string;
  ox: number;
  oz: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  pos: Vec2;
  yaw: number;
  fireT: number;
  deathT: number;
  kills: number;
  reviveT: number;
  moving: boolean;
  phase: number;
  // Cover spot an operator ducks behind while hurt, and seconds left to use it.
  cover?: Vec2 | null;
  coverT?: number;
}

export type Target = { kind: 'player' } | { kind: 'operator'; index: number };

export interface PlayerView {
  pos: Vec3;
  eyeHeight: number;
  alive: boolean;
  moving: boolean;
  ghost: boolean;
  order: 0 | 1 | 2; // ATTACK, HOLD, FOLLOW (legacy ORDERS, index.html:473)
}

export interface SmokeZone {
  pos: Vec3;
  r: number;
}

// Everything AI reads for one tick. AI never mutates the world directly; it returns events.
export interface AiWorld {
  time: number;
  player: PlayerView;
  enemies: readonly Enemy[];
  operators: readonly Operator[];
  nav: NavGrid;
  collision: CollisionWorld;
  smokes: readonly SmokeZone[];
  zones: readonly { x: number; z: number; captured: boolean }[];
  rng: Rng;
  pathBudget: PathBudget;
  // ai is the tactical skill of the hostiles (content/difficulty.ts). Absent means the legacy behaviour.
  difficulty: { dmg: number; ai?: number };
}

export type AiEvent =
  // spread is the cone half-angle from shotSpread (hostile.ts). Combat applies this value, not its own.
  | { type: 'shoot'; shooter: Enemy; target: Target; aim: Vec3; spread: number }
  | { type: 'grenade'; from: Vec3; to: Vec2 }
  | { type: 'spotted'; by: Enemy; target: Target }
  | { type: 'operatorFire'; operator: Operator; enemy: Enemy }
  | { type: 'medicHeal'; at: Vec2 };
