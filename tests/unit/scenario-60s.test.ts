import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Action } from '../../src/content/ids';
import { DIFF } from '../../src/content/difficulty';
import { WEAPONS } from '../../src/content/weapons';
import { getMap } from '../../src/content/maps';
import { createRng } from '../../src/core/rng';
import { CollisionWorld } from '../../src/sim/collision';
import { buildMap, buildingRects } from '../../src/render/map-builder';
import { SimWorld } from '../../src/sim/world';
import type { Command } from '../../src/input/commands';
import type { Vec3 } from '../../src/core/math';

// Phase 3 gate: a seeded 60 s run on Compound with the player standing still at a spawn.
// Checks: no exception, the wave counter reaches 2, every hostile kind is seen, and every position is finite.

const DT = 1 / 60;
const STEPS = 60 * 60;

const IDLE: Command = {
  move: { fwd: 0, strafe: 0 },
  look: { dx: 0, dy: 0 },
  buttons: { fire: false, ads: false },
  pressed: new Set<Action>(),
  crouch: false,
  sprint: false,
};

function isFinite3(p: Vec3): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

describe('60 s seeded scenario on Compound', () => {
  it('runs with no exception, reaches wave 2, sees every hostile kind, and keeps positions finite', () => {
    const started = Date.now();
    const collision = new CollisionWorld();
    const map = buildMap(getMap('compound'), new THREE.Scene(), collision, createRng(1));
    const spawn = map.spawns[0];
    expect(spawn).toBeDefined();
    if (spawn === undefined) return;

    const sim = new SimWorld({
      collision,
      zones: map.zones,
      spawns: map.spawns,
      buildings: buildingRects(map.def),
      rng: createRng(1),
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

    const kinds = new Set<string>();
    let maxWave = 0;
    let shots = 0;
    // Checked every step; asserted once at the end so the loop stays cheap.
    let firstBadStep = -1;
    for (let i = 0; i < STEPS; i++) {
      const events = sim.step(IDLE, DT);
      for (const ev of events) if (ev.type === 'enemyShot') shots += 1;
      maxWave = Math.max(maxWave, sim.wave.wave);
      const finite =
        isFinite3(sim.player.pos) &&
        sim.enemies.every((e) => Number.isFinite(e.pos.x) && Number.isFinite(e.pos.z)) &&
        sim.operators.every((a) => Number.isFinite(a.pos.x) && Number.isFinite(a.pos.z));
      if (!finite && firstBadStep < 0) firstBadStep = i;
      for (const e of sim.enemies) kinds.add(e.kind);
    }

    expect(firstBadStep, 'first step with a non-finite position').toBe(-1);
    expect(maxWave).toBeGreaterThanOrEqual(2);
    for (const kind of ['rifle', 'sniper', 'heavy']) {
      expect(kinds.has(kind), `hostile kind ${kind} seen`).toBe(true);
    }
    // The hostiles should engage a player who stands in their sight, so combat runs at least once.
    expect(shots).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(20_000);
  });
});
