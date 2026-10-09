import { describe, it, expect } from 'vitest';
import { CollisionWorld } from '../../src/sim/collision';
import type { Enemy, Operator } from '../../src/sim/entities';
import type { EnemyKindId } from '../../src/content/enemies';
import {
  blastDamage,
  createSmoke,
  makeGrenade,
  playerThrow,
  stepGrenades,
  stepSmokes,
  type Grenade,
  type GrenadeContext,
  type SmokeCloud,
} from '../../src/sim/grenades';
import { createOperator } from '../../src/sim/squad';

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

// A grenade that is still in the air but explodes on the next step. dt is tiny, so it stays where it is.
function explodeNow(
  kind: 'frag' | 'flash' | 'smoke',
  pos: { x: number; y: number; z: number },
  owner: 'player' | 'enemy' = 'player',
): Grenade {
  return makeGrenade(owner, kind, pos, { x: 0, y: 0, z: 0 }, 0.0001);
}

function ctxFor(
  world: CollisionWorld,
  enemies: Enemy[],
  overrides: Partial<Pick<GrenadeContext, 'operators' | 'smokes' | 'difficulty'>> & {
    player?: Partial<GrenadeContext['player']>;
  } = {},
): GrenadeContext {
  return {
    world,
    enemies,
    operators: overrides.operators ?? [],
    smokes: overrides.smokes ?? [],
    difficulty: overrides.difficulty ?? { dmg: 1 },
    player: {
      pos: { x: 500, y: 0, z: 500 },
      eye: { x: 500, y: 1.5, z: 500 },
      aim: { x: 0, y: 0, z: 1 },
      alive: true,
      ...overrides.player,
    },
  };
}

describe('playerThrow', () => {
  it('starts half a metre ahead of the eye with velocity aim*14 plus 3 up', () => {
    const g = playerThrow('frag', { x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(g.pos).toEqual({ x: 0, y: 1.5, z: 0.5 });
    expect(g.vel).toEqual({ x: 0, y: 3, z: 14 });
    expect(g.fuse).toBe(2.4);
    expect(g.owner).toBe('player');
  });
});

describe('grenade flight', () => {
  it('falls under gravity 16 and bounces off the floor at 0.12 m', () => {
    const world = new CollisionWorld();
    const list = [makeGrenade('player', 'frag', { x: 0, y: 1, z: 0 }, { x: 2, y: 0, z: 0 }, 10)];
    stepGrenades(list, 0.1, ctxFor(world, []));
    const g = list[0];
    expect(g).toBeDefined();
    if (g === undefined) return;
    // vy after one step is -1.6, so y is 1 - 0.16 = 0.84; no bounce yet.
    expect(g.vel.y).toBeCloseTo(-1.6, 9);
    expect(g.pos.y).toBeCloseTo(0.84, 9);
    expect(g.pos.x).toBeCloseTo(0.2, 9);

    // Step until the floor clamp fires: y is set to 0.12 and vy turns upward.
    let bounced = false;
    for (let i = 0; i < 1000 && !bounced; i += 1) {
      stepGrenades(list, 0.001, ctxFor(world, []));
      bounced = g.pos.y === 0.12 && g.vel.y > 0;
    }
    expect(bounced).toBe(true);
    // Floor friction multiplies the horizontal speed by 0.6 on the bounce step.
    expect(g.vel.x).toBeCloseTo(1.2, 9);
  });

  it('reverts into a box and reverses the horizontal speed by 0.3', () => {
    const world = new CollisionWorld();
    world.add({ min: { x: 1, y: 0, z: -1 }, max: { x: 2, y: 3, z: 1 } });
    const g = makeGrenade('player', 'frag', { x: 0.9, y: 2, z: 0 }, { x: 10, y: 0, z: 0 }, 10);
    const list = [g];
    stepGrenades(list, 0.1, ctxFor(world, []));
    expect(g.pos.x).toBeCloseTo(0.9, 9);
    expect(g.vel.x).toBeCloseTo(-3, 9);
  });

  it('explodes when the fuse runs out and is removed from the list', () => {
    const world = new CollisionWorld();
    const list = [makeGrenade('player', 'frag', { x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 0 }, 1)];
    expect(stepGrenades(list, 0.5, ctxFor(world, []))).toEqual([]);
    const events = stepGrenades(list, 0.5, ctxFor(world, []));
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('frag');
    expect(list).toHaveLength(0);
  });
});

describe('frag blast', () => {
  it('deals about 130 to an enemy at the centre', () => {
    const world = new CollisionWorld();
    const enemy = makeEnemy('rifle', 0, 0, 200);
    const list = [explodeNow('frag', { x: 0, y: 1, z: 0 })];
    const events = stepGrenades(list, 0.001, ctxFor(world, [enemy]));
    expect(events[0]?.enemyKills).toEqual([]);
    expect(enemy.hp).toBeCloseTo(70, 2);
  });

  it('deals falloff damage with the legacy formula inside 7 m', () => {
    const world = new CollisionWorld();
    const enemy = makeEnemy('rifle', 3.5, 0, 200);
    const list = [explodeNow('frag', { x: 0, y: 1, z: 0 })];
    stepGrenades(list, 0.001, ctxFor(world, [enemy]));
    // 130 * (1 - 3.5 / 7) = 65
    expect(enemy.hp).toBeCloseTo(135, 2);
  });

  it('does nothing to an enemy 8 m away', () => {
    const world = new CollisionWorld();
    const enemy = makeEnemy('rifle', 8, 0, 200);
    stepGrenades([explodeNow('frag', { x: 0, y: 1, z: 0 })], 0.001, ctxFor(world, [enemy]));
    expect(enemy.hp).toBe(200);
  });

  it('is blocked by a wall between the blast and the enemy', () => {
    const world = new CollisionWorld();
    world.add({ min: { x: 1, y: 0, z: -5 }, max: { x: 1.5, y: 3, z: 5 } });
    const enemy = makeEnemy('rifle', 3, 0, 200);
    stepGrenades([explodeNow('frag', { x: 0, y: 1, z: 0 })], 0.001, ctxFor(world, [enemy]));
    expect(enemy.hp).toBe(200);
  });

  it('kills an enemy whose hp is spent and reports it', () => {
    const world = new CollisionWorld();
    const enemy = makeEnemy('rifle', 0, 0, 50);
    const events = stepGrenades([explodeNow('frag', { x: 0, y: 1, z: 0 })], 0.001, ctxFor(world, [enemy]));
    expect(enemy.alive).toBe(false);
    expect(events[0]?.enemyKills).toEqual([enemy]);
  });

  it('hurts the player inside the blast with 70 at the centre', () => {
    const world = new CollisionWorld();
    const events = stepGrenades(
      [explodeNow('frag', { x: 0, y: 1, z: 0 })],
      0.001,
      ctxFor(world, [], { player: { pos: { x: 0, y: 0, z: 0 }, eye: { x: 0, y: 1.5, z: 0 } } }),
    );
    expect(events[0]?.playerDamage).toBeCloseTo(70, 2);
  });
});

describe('blastDamage', () => {
  const world = new CollisionWorld();

  it('is 130 for an enemy at the centre and 0 at 7 m', () => {
    const at = makeEnemy('rifle', 0, 0, 200);
    const far = makeEnemy('rifle', 7, 0, 200);
    const r = blastDamage({ x: 0, y: 1, z: 0 }, 7, 130, 70, [at, far], world, null);
    expect(r.enemies).toEqual([{ enemy: at, amount: 130 }]);
    expect(r.playerDamage).toBe(0);
  });

  it('returns the player amount with the falloff for 3 m', () => {
    const r = blastDamage({ x: 0, y: 1, z: 0 }, 7, 130, 70, [], world, { x: 3, y: 0, z: 0 });
    expect(r.playerDamage).toBeCloseTo(40, 9);
  });

  it('skips dead enemies', () => {
    const dead = makeEnemy('rifle', 0, 0, 200);
    dead.alive = false;
    expect(blastDamage({ x: 0, y: 1, z: 0 }, 7, 130, 70, [dead], world, null).enemies).toEqual([]);
  });
});

describe('enemy frag', () => {
  it('hurts the player with 80 scaled by difficulty and falloff, and operators with 90', () => {
    const world = new CollisionWorld();
    const op: Operator = createOperator(0);
    op.pos = { x: 0, z: 0 };
    op.alive = true;
    const events = stepGrenades(
      [explodeNow('frag', { x: 0, y: 1, z: 0 }, 'enemy')],
      0.001,
      ctxFor(world, [], {
        operators: [op],
        difficulty: { dmg: 1.35 },
        player: { pos: { x: 2, y: 0, z: 0 }, eye: { x: 2, y: 1.5, z: 0 } },
      }),
    );
    // player centre at (2, 1, 0): distance 2 from the blast
    expect(events[0]?.playerDamage).toBeCloseTo(80 * 1.35 * (1 - 2 / 7), 2);
    // operator centre at (0, 1, 0): distance 0, full 90
    expect(op.hp).toBeCloseTo(op.maxHp - 90, 2);
  });
});

describe('flashbang', () => {
  it('blinds a player-thrown flash: hostile in view within 18 m for 3.5 s', () => {
    const world = new CollisionWorld();
    const enemy = makeEnemy('rifle', 0, 0, 60);
    stepGrenades([explodeNow('flash', { x: 0, y: 1.5, z: 5 })], 0.001, ctxFor(world, [enemy]));
    expect(enemy.blind).toBe(3.5);
  });

  it('does not blind a hostile beyond 18 m', () => {
    const world = new CollisionWorld();
    const enemy = makeEnemy('rifle', 0, 0, 60);
    stepGrenades([explodeNow('flash', { x: 0, y: 1.5, z: 19 })], 0.001, ctxFor(world, [enemy]));
    expect(enemy.blind).toBe(0);
  });

  it('does not blind a hostile behind a wall', () => {
    const world = new CollisionWorld();
    world.add({ min: { x: -1, y: 0, z: 2 }, max: { x: 1, y: 3, z: 3 } });
    const enemy = makeEnemy('rifle', 0, 0, 60);
    stepGrenades([explodeNow('flash', { x: 0, y: 1.5, z: 5 })], 0.001, ctxFor(world, [enemy]));
    expect(enemy.blind).toBe(0);
  });

  it('blinds the player for 3 s when they are looking at the flash', () => {
    const world = new CollisionWorld();
    const events = stepGrenades(
      [explodeNow('flash', { x: 0, y: 1.5, z: 10 })],
      0.001,
      ctxFor(world, [], {
        player: { pos: { x: 0, y: 0, z: 0 }, eye: { x: 0, y: 1.5, z: 0 }, aim: { x: 0, y: 0, z: 1 } },
      }),
    );
    expect(events[0]?.playerFlashT).toBe(3);
  });

  it('does not blind the player when they face away', () => {
    const world = new CollisionWorld();
    const events = stepGrenades(
      [explodeNow('flash', { x: 0, y: 1.5, z: 10 })],
      0.001,
      ctxFor(world, [], {
        player: { pos: { x: 0, y: 0, z: 0 }, eye: { x: 0, y: 1.5, z: 0 }, aim: { x: 0, y: 0, z: -1 } },
      }),
    );
    expect(events[0]?.playerFlashT).toBe(0);
  });
});

describe('smoke', () => {
  it('creates a cloud at (x, 1.2, z) with radius 3.6 that lasts 9 s', () => {
    const world = new CollisionWorld();
    const smokes: SmokeCloud[] = [];
    stepGrenades([explodeNow('smoke', { x: 4, y: 1, z: -2 })], 0.001, ctxFor(world, [], { smokes }));
    expect(smokes).toHaveLength(1);
    const cloud = smokes[0];
    expect(cloud?.pos).toEqual({ x: 4, y: 1.2, z: -2 });
    expect(cloud?.r).toBe(3.6);
    expect(cloud?.t).toBeCloseTo(9, 2);
  });

  it('fades opacity over the last 2 s and is removed at zero', () => {
    const cloud = createSmoke({ x: 0, y: 0, z: 0 });
    expect(cloud.opacity).toBeCloseTo(0.55, 9);
    const list = [cloud];
    stepSmokes(list, 7);
    expect(cloud.t).toBeCloseTo(2, 9);
    expect(cloud.opacity).toBeCloseTo(0.55, 9);
    stepSmokes(list, 1);
    expect(cloud.opacity).toBeCloseTo(0.275, 9);
    stepSmokes(list, 1);
    expect(list).toHaveLength(0);
  });
});
