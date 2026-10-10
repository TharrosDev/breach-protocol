// Micro-benchmarks for the sim hot paths. Run: npx tsx scripts/bench-sim.ts
// Single-threaded and short (a few seconds). Prints ms per call so before/after can be compared.
import * as THREE from 'three';
import type { Action } from '../src/content/ids';
import { DIFF } from '../src/content/difficulty';
import { WEAPONS } from '../src/content/weapons';
import { getMap } from '../src/content/maps';
import { createRng } from '../src/core/rng';
import { CollisionWorld } from '../src/sim/collision';
import { buildMap, buildingRects } from '../src/render/map-builder';
import { SimWorld } from '../src/sim/world';
import type { Command } from '../src/input/commands';

const IDLE: Command = {
  move: { fwd: 0, strafe: 0 },
  look: { dx: 0, dy: 0 },
  buttons: { fire: false, ads: false },
  pressed: new Set<Action>(),
  crouch: false,
  sprint: false,
};

function make(mapId: 'compound' | 'depot' | 'substation', seed: number) {
  const collision = new CollisionWorld();
  const map = buildMap(getMap(mapId), new THREE.Scene(), collision, createRng(seed));
  const spawn = map.spawns[0];
  if (spawn === undefined) throw new Error('map has no spawn');
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
  return { sim, collision, map };
}

function time(label: string, iters: number, fn: () => void): void {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const ms = performance.now() - t0;
  console.log(
    `${label.padEnd(44)} ${(ms / iters).toFixed(5)} ms/call  (${String(iters)} calls, ${ms.toFixed(0)} ms)`,
  );
}

for (const id of ['compound', 'depot', 'substation'] as const) {
  const { sim, collision } = make(id, 1);
  console.log(`--- ${id}: ${String(collision.footprints().length)} boxes`);
  time('raycast 40 m (eye level)', 20000, () => {
    collision.raycast({ x: 0, y: 1.5, z: 40 }, { x: 0, y: 0, z: -1 }, 40);
  });
  time('pointFree', 50000, () => {
    collision.pointFree(3.3, 4.4, 0.4);
  });
  const p = { x: 3.3, z: 4.4 };
  time('pushOut', 50000, () => {
    p.x = 3.3;
    p.z = 4.4;
    collision.pushOut(p, 0.4);
  });
  // Warm up to wave 3 with many hostiles, then time the tick.
  let steps = 0;
  while (sim.wave.wave < 4 && steps < 60 * 90) {
    sim.step(IDLE, 1 / 60);
    steps++;
  }
  console.log(
    `warmed ${String(steps)} steps, hostiles alive: ${String(sim.enemies.filter((e) => e.alive).length)}`,
  );
  time('SimWorld.step (wave 4 population)', 600, () => {
    sim.step(IDLE, 1 / 60);
  });
}

// Whole-run: seeded 60 s Compound scenario, like the unit test.
{
  const { sim } = make('compound', 1);
  const t0 = performance.now();
  for (let i = 0; i < 3600; i++) sim.step(IDLE, 1 / 60);
  console.log(`60 s compound scenario (3600 ticks): ${(performance.now() - t0).toFixed(0)} ms`);
  console.log(
    `final: wave ${String(sim.wave.wave)}, enemies ${String(sim.enemies.length)}, tickets ${String(sim.enemyTickets)}, score ${String(sim.score)}, ` +
      `hp ${sim.player.hp.toFixed(2)}, pos ${sim.enemies
        .slice(0, 3)
        .map((e) => e.pos.x.toFixed(3) + ',' + e.pos.z.toFixed(3))
        .join(' | ')}`,
  );
}

// Pathfinding: corner-to-corner searches on each map.
for (const id of ['compound', 'depot', 'substation'] as const) {
  const { sim } = make(id, 1);
  const budget = { take: (): boolean => true };
  let found = 0;
  time(`A* corner to corner (${id})`, 300, () => {
    if (sim.nav.findPath(-50, -50, 50, 50, budget) !== null) found++;
  });
  console.log(`  paths found: ${String(found)}`);
}
