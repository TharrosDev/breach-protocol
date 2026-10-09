import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/core/rng';
import { CollisionWorld, type Aabb } from '../../src/sim/collision';
import type { AiWorld, Enemy, Operator, PlayerView, SmokeZone } from '../../src/sim/entities';
import type { NavGrid, PathBudget } from '../../src/sim/nav/types';
import { ENEMY_DEFS, type EnemyKindId } from '../../src/content/enemies';
import { visibleTarget, losClear, smokeBlocks } from '../../src/sim/ai/perception';
import { findCover } from '../../src/sim/ai/cover';
import { goTo, handleStuck, stepTo, type Mover } from '../../src/sim/ai/movement';

// Fake nav: everything walkable, straight lines always clear, no A* paths.
const openNav: NavGrid = {
  size: 120,
  rebuild() {},
  isWalk: () => true,
  lineWalk: () => true,
  findPath: () => [],
};

const budget: PathBudget = { take: () => true };

function makeEnemy(kind: EnemyKindId, x: number, z: number, over: Partial<Enemy> = {}): Enemy {
  const def = ENEMY_DEFS[kind];
  return {
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
    path: null,
    pathIdx: 0,
    pathT: 0,
    pathTx: 0,
    pathTz: 0,
    stuckT: 0,
    unstuck: 0,
    sideX: 0,
    sideZ: 0,
    ...over,
  };
}

function makeWorld(
  opts: {
    player?: Partial<PlayerView>;
    operators?: Operator[];
    enemies?: Enemy[];
    smokes?: SmokeZone[];
    collision?: CollisionWorld;
    nav?: NavGrid;
    seed?: number;
  } = {},
): AiWorld {
  const player: PlayerView = {
    pos: { x: 0, y: 0, z: 20 },
    eyeHeight: 1.7,
    alive: true,
    moving: false,
    ghost: false,
    order: 0,
    ...opts.player,
  };
  return {
    time: 0,
    player,
    enemies: opts.enemies ?? [],
    operators: opts.operators ?? [],
    nav: opts.nav ?? openNav,
    collision: opts.collision ?? new CollisionWorld(),
    smokes: opts.smokes ?? [],
    zones: [],
    rng: createRng(opts.seed ?? 1),
    pathBudget: budget,
    difficulty: { dmg: 1 },
  };
}

function makeOperator(x: number, z: number, over: Partial<Operator> = {}): Operator {
  return {
    name: 'Op',
    ox: 0,
    oz: 0,
    alive: true,
    hp: 100,
    maxHp: 100,
    pos: { x, z },
    yaw: 0,
    fireT: 0,
    deathT: 0,
    kills: 0,
    reviveT: 0,
    moving: false,
    phase: 0,
    path: null,
    pathIdx: 0,
    pathT: 0,
    pathTx: 0,
    pathTz: 0,
    stuckT: 0,
    unstuck: 0,
    sideX: 0,
    sideZ: 0,
    ...over,
  };
}

function box(minX: number, minZ: number, maxX: number, maxZ: number): Aabb {
  return { min: { x: minX, y: 0, z: minZ }, max: { x: maxX, y: 2, z: maxZ } };
}

describe('perception: visibleTarget', () => {
  it('sees the player in open ground at 20 m with the eye at pos.y + eyeHeight', () => {
    const e = makeEnemy('rifle', 0, 0);
    const w = makeWorld();
    const s = visibleTarget(e, w);
    expect(s).not.toBeNull();
    expect(s?.target).toEqual({ kind: 'player' });
    expect(s?.eyeY).toBeCloseTo(1.7, 10);
  });

  it('does not see the player beyond the enemy sight radius', () => {
    const e = makeEnemy('rifle', 0, 0); // sight 50
    expect(visibleTarget(e, makeWorld({ player: { pos: { x: 0, y: 0, z: 60 } } }))).toBeNull();
  });

  it('ghost perk cuts sight to 0.7 of the enemy sight', () => {
    const e = makeEnemy('rifle', 0, 0); // sight 50, so 35 with ghost
    const at40 = { pos: { x: 0, y: 0, z: 40 } };
    expect(visibleTarget(e, makeWorld({ player: at40 }))).not.toBeNull();
    expect(visibleTarget(e, makeWorld({ player: { ...at40, ghost: true } }))).toBeNull();
  });

  it('sees a living operator at eye height 1.5 and ignores a dead one', () => {
    const e = makeEnemy('rifle', 0, 0);
    const alive = makeOperator(0, 10);
    const w = makeWorld({ player: { alive: false }, operators: [alive] });
    const s = visibleTarget(e, w);
    expect(s?.target).toEqual({ kind: 'operator', index: 0 });
    expect(s?.eyeY).toBe(1.5);

    const dead = makeWorld({ player: { alive: false }, operators: [makeOperator(0, 10, { alive: false })] });
    expect(visibleTarget(e, dead)).toBeNull();
  });

  it('a box between enemy and player blocks sight', () => {
    const e = makeEnemy('rifle', 0, 0);
    const collision = new CollisionWorld();
    collision.add(box(-2, 8, 2, 9));
    expect(visibleTarget(e, makeWorld({ collision }))).toBeNull();
  });

  it('smoke on the sight line blocks sight; smoke off the line does not', () => {
    const e = makeEnemy('rifle', 0, 0);
    expect(visibleTarget(e, makeWorld({ smokes: [{ pos: { x: 0, y: 1.6, z: 10 }, r: 2 }] }))).toBeNull();
    expect(visibleTarget(e, makeWorld({ smokes: [{ pos: { x: 8, y: 1.6, z: 10 }, r: 2 }] }))).not.toBeNull();
  });
});

describe('perception: losClear and smokeBlocks', () => {
  it('losClear is true with no boxes and false behind a box', () => {
    const collision = new CollisionWorld();
    const w = makeWorld({ collision });
    expect(losClear({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, w)).toBe(true);
    collision.add(box(-1, 4, 1, 5));
    expect(losClear({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, w)).toBe(false);
  });

  it('smokeBlocks uses distance from the sphere centre to the segment', () => {
    const smokes = [{ pos: { x: 0, y: 0, z: 5 }, r: 1 }];
    expect(smokeBlocks({ x: -5, y: 0, z: 5 }, { x: 5, y: 0, z: 5 }, smokes)).toBe(true);
    expect(smokeBlocks({ x: -5, y: 2, z: 5 }, { x: 5, y: 2, z: 5 }, smokes)).toBe(false);
  });
});

describe('cover: findCover', () => {
  // Player at (0, 20) with eye at 1.7. A wall at x 2..3 hides the east side of the enemy's surroundings.
  it('returns a hidden point 3 to 8 m from the enemy', () => {
    const collision = new CollisionWorld();
    collision.add(box(2, -30, 3, 15));
    const e = makeEnemy('rifle', 0, 0);
    const w = makeWorld({ collision, seed: 7 });
    const cover = findCover(e, 0, 1.7, 20, w);
    expect(cover).not.toBeNull();
    if (cover === null) return;
    const r = Math.hypot(cover.x, cover.z);
    expect(r).toBeGreaterThanOrEqual(3);
    expect(r).toBeLessThanOrEqual(8);
    const spot = { x: cover.x, y: 1.2, z: cover.z };
    const target = { x: 0, y: 1.7, z: 20 };
    expect(losClear(target, spot, w) && !smokeBlocks(target, spot, w.smokes)).toBe(false);
  });

  it('returns null when nothing hides the enemy', () => {
    const e = makeEnemy('rifle', 0, 0);
    expect(findCover(e, 0, 1.7, 20, makeWorld())).toBeNull();
  });
});

describe('movement: stepTo, goTo, handleStuck', () => {
  it('stepTo moves at speed * dt toward the target and faces it', () => {
    const m: Mover = makeEnemy('rifle', 0, 0);
    const moved = stepTo(m, 10, 0, 2, 0.5, makeWorld());
    expect(moved).toBeCloseTo(1, 10);
    expect(m.pos.x).toBeCloseTo(1, 10);
    expect(m.yaw).toBeCloseTo(Math.PI / 2, 10);
  });

  it('stepTo returns -1 when already at the target', () => {
    const m: Mover = makeEnemy('rifle', 3, 3);
    expect(stepTo(m, 3, 3, 2, 0.5, makeWorld())).toBe(-1);
  });

  it('stepTo is held off a box by the 0.4 m body radius', () => {
    const collision = new CollisionWorld();
    collision.add(box(0.5, -5, 2, 5));
    const m: Mover = makeEnemy('rifle', 0, 0);
    stepTo(m, 10, 0, 3, 0.1, makeWorld({ collision }));
    expect(m.pos.x).toBeCloseTo(0.1, 6);
  });

  it('goTo walks straight when the line is clear', () => {
    const m: Mover = makeEnemy('rifle', 0, 0);
    goTo(m, 0, 10, 2, 0.5, makeWorld());
    expect(m.pos.z).toBeCloseTo(1, 10);
    expect(m.path).toBeNull();
  });

  it('goTo follows the first waypoint of an A* path', () => {
    const nav: NavGrid = {
      ...openNav,
      lineWalk: () => false,
      findPath: () => [
        { x: 0, z: 4 },
        { x: 6, z: 4 },
      ],
    };
    const m: Mover = makeEnemy('rifle', 0, 0);
    goTo(m, 6, 4, 2, 0.5, makeWorld({ nav }));
    expect(m.path?.length).toBe(2);
    expect(m.pos.z).toBeGreaterThan(0);
    expect(m.pos.x).toBeCloseTo(0, 10);
  });

  it('goTo treats a null path as unreachable and walks straight for the path TTL', () => {
    const nav: NavGrid = { ...openNav, lineWalk: () => false, findPath: () => null };
    const m: Mover = makeEnemy('rifle', 0, 0);
    goTo(m, 10, 0, 2, 0.5, makeWorld({ nav }));
    expect(m.path).toEqual([]);
    expect(m.pathT).toBeCloseTo(1.5, 10);
    expect(m.pos.x).toBeCloseTo(1, 10);
  });

  it('handleStuck starts a 1 s escape after 0.7 s with almost no movement', () => {
    const m = makeEnemy('rifle', 0, 0);
    const w = makeWorld();
    for (let i = 0; i < 7; i += 1) handleStuck(m, 0, 3.1, 0.1, w);
    expect(m.unstuck).toBe(0);
    handleStuck(m, 0, 3.1, 0.1, w);
    expect(m.unstuck).toBe(1);
    expect(Math.hypot(m.sideX, m.sideZ)).toBeCloseTo(1, 10);
  });

  it('handleStuck ignores ticks where no move was attempted (mv < 0)', () => {
    const m = makeEnemy('rifle', 0, 0);
    for (let i = 0; i < 20; i += 1) handleStuck(m, -1, 3.1, 0.1, makeWorld());
    expect(m.stuckT).toBe(0);
    expect(m.unstuck).toBe(0);
  });
});
