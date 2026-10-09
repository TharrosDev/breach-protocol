import * as THREE from 'three';
import type { Action } from '../../../src/content/ids';
import { DIFF } from '../../../src/content/difficulty';
import { ENEMY_DEFS, type EnemyKindId } from '../../../src/content/enemies';
import { getMap } from '../../../src/content/maps';
import { WEAPONS } from '../../../src/content/weapons';
import { createRng } from '../../../src/core/rng';
import { CollisionWorld } from '../../../src/sim/collision';
import type { Enemy } from '../../../src/sim/entities';
import type { Command } from '../../../src/input/commands';
import { buildMap, buildingRects } from '../../../src/render/map-builder';
import { SimWorld, type SimOptions } from '../../../src/sim/world';

// Shared fixtures for the sim tests: an idle command, a hostile with the legacy fields, an open-field
// SimWorld, and a SimWorld on Compound built through the same map builder the game uses.

export const DT = 1 / 60;

export const IDLE: Command = {
  move: { fwd: 0, strafe: 0 },
  look: { dx: 0, dy: 0 },
  buttons: { fire: false, ads: false },
  pressed: new Set<Action>(),
  crouch: false,
  sprint: false,
};

// A command with the given actions pressed on this tick only.
export function pressing(...actions: Action[]): Command {
  return { ...IDLE, pressed: new Set<Action>(actions) };
}

export function makeEnemy(kind: EnemyKindId, x: number, z: number): Enemy {
  const def = ENEMY_DEFS[kind];
  return {
    path: null,
    pathIdx: 0,
    pathT: 0,
    pathTx: 0,
    pathTz: 0,
    stuckT: 0,
    unstuck: 0,
    sideX: 0,
    sideZ: 0,
    kind,
    alive: true,
    hp: def.hp,
    maxHp: def.hp,
    pos: { x, z },
    yaw: 0,
    state: 'hunt',
    home: null,
    lastSeen: null,
    sight: def.sight,
    role: 'push',
    flankSide: 1,
    fireT: 0,
    blind: 0,
    coverT: 0,
    grenT: 0,
    cover: null,
    engaged: false,
    unseenT: 0,
    flinchT: 0,
    strafeT: 1,
    strafeDir: 1,
    moving: false,
    phase: 0,
    deathT: 0,
    spot: 0,
    gx: 0,
    gz: 0,
    kick: 0,
    crouch: 0,
  };
}

// Options for an open field with no colliders. The one zone is far away, so it neither captures nor ends the match.
export function openFieldOptions(overrides: Partial<SimOptions> = {}): SimOptions {
  return {
    collision: new CollisionWorld(),
    zones: [{ name: 'Far', x: 500, z: 500 }],
    spawns: [{ x: 0, z: 40 }],
    buildings: [],
    rng: createRng(1),
    difficulty: DIFF.veteran,
    weapon: WEAPONS.vx,
    attachment: 'reflex',
    perk: 'steady',
    adsRate: 17,
    playerSpawn: { x: 0, y: 0, z: 0 },
    playerYaw: 0,
    gadgets: ['frag', 'smoke'],
    crates: [],
    mapName: 'Test',
    ...overrides,
  };
}

export function openFieldSim(overrides: Partial<SimOptions> = {}): SimWorld {
  return new SimWorld(openFieldOptions(overrides));
}

// Compound built through buildMap, with the player on the first ring spawn and no hostiles. Zones, crates and
// breakable walls are the real ones.
export function compoundSim(seed = 1): {
  sim: SimWorld;
  collision: CollisionWorld;
  spawn: { x: number; z: number };
} {
  const collision = new CollisionWorld();
  const map = buildMap(getMap('compound'), new THREE.Scene(), collision, createRng(seed));
  const spawn = map.spawns[0];
  if (spawn === undefined) throw new RangeError('Compound has no spawn point');
  const sim = new SimWorld({
    collision,
    zones: map.zones,
    spawns: map.spawns,
    buildings: buildingRects(map.def),
    rng: createRng(seed),
    difficulty: DIFF.veteran,
    weapon: WEAPONS.vx,
    attachment: 'reflex',
    perk: 'lightweight',
    adsRate: 17,
    playerSpawn: { x: spawn.x, y: 0, z: spawn.z },
    playerYaw: Math.atan2(-spawn.x, -spawn.z),
    gadgets: ['frag', 'smoke'],
    crates: map.pickups,
    mapName: map.def.name,
  });
  sim.enemies = [];
  return { sim, collision, spawn };
}
