import { describe, it, expect } from 'vitest';
import type { Vec2 } from '../../src/core/math';
import { createRng } from '../../src/core/rng';
import type { EnemyKindId } from '../../src/content/enemies';
import { CollisionWorld } from '../../src/sim/collision';
import type { Enemy, SmokeZone } from '../../src/sim/entities';
import { createTurret, placeSentry, stepTurrets, type Turret, type TurretEvent } from '../../src/sim/turret';

function makeEnemy(kind: EnemyKindId, x: number, z: number, hp: number): Enemy {
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
    hp,
    maxHp: hp,
    pos: { x, z },
    yaw: 0,
    state: 'guard',
    home: null,
    lastSeen: null,
    sight: 50,
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
    strafeT: 0,
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

const NO_SMOKE: readonly SmokeZone[] = [];

describe('placeSentry', () => {
  // Ground point dist metres straight ahead along +z from the origin.
  const ahead = (dist: number): Vec2 => ({ x: 0, z: dist });

  it('places at 8 m when that ground is clear', () => {
    const result = placeSentry(ahead, () => true, 0.25);
    expect(result.placed).toBe(true);
    if (!result.placed) return;
    expect(result.turret.pos).toEqual({ x: 0, y: 1.2, z: 8 });
    expect(result.turret.yaw).toBe(0.25);
  });

  it('falls back from 8 m to 2 m, testing each distance in order with radius 0.6', () => {
    const tried: number[] = [];
    const isOpen = (x: number, z: number, r: number): boolean => {
      expect(r).toBe(0.6);
      expect(x).toBe(0);
      tried.push(z);
      return z <= 2.5; // only the 2 m point is clear
    };
    const result = placeSentry(ahead, isOpen, 0);
    expect(tried).toEqual([8, 6, 4, 2]);
    expect(result.placed).toBe(true);
    if (!result.placed) return;
    expect(result.turret.pos).toEqual({ x: 0, y: 1.2, z: 2 });
  });

  it('fails when no distance has clear ground', () => {
    expect(placeSentry(ahead, () => false, 0)).toEqual({ placed: false });
  });

  it('fails when no clearance check is supplied', () => {
    expect(placeSentry(ahead, null, 0)).toEqual({ placed: false });
  });
});

describe('createTurret', () => {
  it('starts at 45 s of life, ready to fire, at height 1.2', () => {
    const tu = createTurret({ x: 3, z: -4 }, 1);
    expect(tu).toEqual({ pos: { x: 3, y: 1.2, z: -4 }, yaw: 1, fireT: 0, t: 45 });
  });
});

describe('sentry turret fire', () => {
  it('kills a stationary enemy in front within a few seconds', () => {
    const rng = createRng(1);
    const world = new CollisionWorld();
    const enemy = makeEnemy('rifle', 0, 10, 60);
    const turrets: Turret[] = [createTurret({ x: 0, z: 0 }, 0)];
    const hits: TurretEvent[] = [];

    const dt = 1 / 60;
    let killed = false;
    for (let frame = 0; frame < 5 * 60 && !killed; frame += 1) {
      for (const ev of stepTurrets(turrets, [enemy], world, NO_SMOKE, rng, dt)) {
        if (ev.hitEnemy !== null) hits.push(ev);
        if (ev.killed) killed = true;
      }
    }

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.hitEnemy === enemy)).toBe(true);
    // Shots aim at 1.5 m, inside the head sphere (centre 1.6 m), so a standing target takes head
    // hits: 2 x 12 = 24 per shot. A body-only hit is 12.
    for (const h of hits) {
      expect(h.damage).toBe(12 * (h.head ? 2 : 1));
    }
    expect(hits[0]?.head).toBe(true);
    expect(enemy.alive).toBe(false);
    expect(killed).toBe(true);
  });

  it('does not fire through a wall', () => {
    const rng = createRng(1);
    const world = new CollisionWorld();
    world.add({ min: { x: -1, y: 0, z: 4.5 }, max: { x: 1, y: 3, z: 5.5 } });
    const enemy = makeEnemy('rifle', 0, 10, 60);
    const turrets: Turret[] = [createTurret({ x: 0, z: 0 }, 0)];
    let events = 0;
    for (let i = 0; i < 60; i += 1) {
      events += stepTurrets(turrets, [enemy], world, NO_SMOKE, rng, 1 / 60).length;
    }
    expect(events).toBe(0);
    expect(enemy.hp).toBe(60);
  });

  it('does not fire through smoke', () => {
    const rng = createRng(1);
    const world = new CollisionWorld();
    const enemy = makeEnemy('rifle', 0, 10, 60);
    const turrets: Turret[] = [createTurret({ x: 0, z: 0 }, 0)];
    const smoke: SmokeZone[] = [{ pos: { x: 0, y: 1.4, z: 5 }, r: 2 }];
    const events = stepTurrets(turrets, [enemy], world, smoke, rng, 1 / 60);
    expect(events).toHaveLength(0);
  });

  it('turns toward a target before it fires', () => {
    const rng = createRng(1);
    const world = new CollisionWorld();
    // Target 90 degrees to the side: atan2(10, 0) = PI / 2.
    const enemy = makeEnemy('rifle', 10, 0, 60);
    const turrets: Turret[] = [createTurret({ x: 0, z: 0 }, 0)];
    const first = stepTurrets(turrets, [enemy], world, NO_SMOKE, rng, 1 / 60);
    expect(first).toHaveLength(0);
    expect(turrets[0]?.yaw ?? 0).toBeGreaterThan(0);
    expect(turrets[0]?.yaw ?? 0).toBeLessThan(Math.PI / 2);
  });
});

describe('sentry turret lifetime', () => {
  it('expires after 45 s and is removed without firing', () => {
    const rng = createRng(1);
    const world = new CollisionWorld();
    const turrets: Turret[] = [createTurret({ x: 0, z: 0 }, 0)];
    // dt = 0.5 is exact in binary: 89 frames is 44.5 s, 90 frames is 45 s.
    for (let i = 0; i < 89; i += 1) stepTurrets(turrets, [], world, NO_SMOKE, rng, 0.5);
    expect(turrets).toHaveLength(1);
    expect(turrets[0]?.t).toBe(0.5);
    stepTurrets(turrets, [], world, NO_SMOKE, rng, 0.5);
    expect(turrets).toHaveLength(0);
  });
});
