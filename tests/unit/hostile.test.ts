import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/core/rng';
import { CollisionWorld, type Aabb } from '../../src/sim/collision';
import type { AiEvent, AiWorld, Enemy, Operator, PlayerView, SmokeZone } from '../../src/sim/entities';
import type { NavGrid, PathBudget } from '../../src/sim/nav/types';
import { ENEMY_DEFS, type EnemyKindId } from '../../src/content/enemies';
import { stepHostile, shareIntel, alertEnemies, shotSpread } from '../../src/sim/ai/hostile';
import { losClear, smokeBlocks } from '../../src/sim/ai/perception';

// Fake nav: everything walkable, straight lines always clear, no A* paths.
const openNav: NavGrid = {
  size: 120,
  rebuild() {},
  isWalk: () => true,
  lineWalk: () => true,
  findPath: () => [],
};

const budget: PathBudget = { take: () => true };

// Player far outside every enemy's sight, so hostiles tick without seeing anyone.
const UNSEEN_PLAYER: Partial<PlayerView> = { pos: { x: 0, y: 0, z: 200 } };

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
    nav: openNav,
    collision: opts.collision ?? new CollisionWorld(),
    smokes: opts.smokes ?? [],
    zones: [],
    rng: createRng(opts.seed ?? 1),
    pathBudget: budget,
    difficulty: { dmg: 1 },
  };
}

function box(minX: number, minZ: number, maxX: number, maxZ: number): Aabb {
  return { min: { x: minX, y: 0, z: minZ }, max: { x: maxX, y: 2, z: maxZ } };
}

function ofType<T extends AiEvent['type']>(events: AiEvent[], type: T): Extract<AiEvent, { type: T }>[] {
  return events.filter((ev): ev is Extract<AiEvent, { type: T }> => ev.type === type);
}

describe('stepHostile: guard and hunt movement', () => {
  it('a guard at home stays home', () => {
    const e = makeEnemy('rifle', 0, 0, { state: 'guard', home: { x: 0, z: 0 } });
    const w = makeWorld({ player: UNSEEN_PLAYER, enemies: [e] });
    let events: AiEvent[] = [];
    for (let i = 0; i < 20; i += 1) events = [...events, ...stepHostile(e, w, 0.1)];
    expect(events).toEqual([]);
    expect(e.pos).toEqual({ x: 0, z: 0 });
    expect(e.state).toBe('guard');
  });

  it('a guard pulled more than 1.5 m from home walks back', () => {
    const e = makeEnemy('rifle', 3, 0, { state: 'guard', home: { x: 0, z: 0 } });
    const w = makeWorld({ player: UNSEEN_PLAYER, enemies: [e] });
    stepHostile(e, w, 0.5);
    expect(e.pos.x).toBeLessThan(3);
  });

  it('a hunt enemy moves toward lastSeen at 0.9 of its speed', () => {
    const e = makeEnemy('rifle', 0, 0, { state: 'hunt', lastSeen: { x: 10, z: 0 } });
    const w = makeWorld({ player: UNSEEN_PLAYER, enemies: [e] });
    stepHostile(e, w, 0.5);
    expect(e.pos.x).toBeCloseTo(ENEMY_DEFS.rifle.speed * 0.9 * 0.5, 6);
    expect(e.pos.z).toBeCloseTo(0, 6);
    expect(e.lastSeen).toEqual({ x: 10, z: 0 });
  });

  it('lastSeen is cleared once the hunter is within 1.5 m of it', () => {
    const e = makeEnemy('rifle', 9, 0, { state: 'hunt', lastSeen: { x: 10, z: 0 } });
    const w = makeWorld({ player: UNSEEN_PLAYER, enemies: [e] });
    stepHostile(e, w, 0.1);
    expect(e.lastSeen).toBeNull();
  });
});

describe('stepHostile: sniper band', () => {
  it('a sniper seeing the player at 20 m backs off', () => {
    const e = makeEnemy('sniper', 0, 0, { engaged: true });
    const w = makeWorld({ enemies: [e] }); // player at (0, 20)
    stepHostile(e, w, 0.5);
    // Back off 6 m away from the player at 2.4 m/s for 0.5 s.
    expect(e.pos.z).toBeCloseTo(-ENEMY_DEFS.sniper.speed * 0.5, 6);
  });

  it('a sniper keeps between 28 and 40 m once backed off', () => {
    const e = makeEnemy('sniper', 0, 0, { engaged: true });
    const w = makeWorld({ enemies: [e] });
    for (let i = 0; i < 40; i += 1) stepHostile(e, w, 0.5);
    const dist = Math.hypot(0 - e.pos.x, 20 - e.pos.z);
    expect(dist).toBeGreaterThanOrEqual(28);
    expect(dist).toBeLessThanOrEqual(40);
  });

  it('a sniper seeing the player at 35 m holds position', () => {
    const e = makeEnemy('sniper', 0, 0, { engaged: true });
    const w = makeWorld({ player: { pos: { x: 0, y: 0, z: 35 } }, enemies: [e] });
    for (let i = 0; i < 10; i += 1) stepHostile(e, w, 0.5);
    expect(e.pos).toEqual({ x: 0, z: 0 });
  });
});

describe('stepHostile: combat movement', () => {
  it('a flanker at range swings to the side of the player', () => {
    const e = makeEnemy('rifle', 0, 0, { engaged: true, role: 'flank', flankSide: 1 });
    const w = makeWorld({ enemies: [e] }); // player at (0, 20), dd 20 > 9
    stepHostile(e, w, 0.5);
    // Flank point is (-9, 20) for flankSide 1, so the enemy moves toward negative x.
    expect(e.pos.x).toBeLessThan(0);
  });

  it('a heavy at 12 m pushes in toward the player', () => {
    const e = makeEnemy('heavy', 0, 8, { engaged: true });
    const w = makeWorld({ enemies: [e] }); // dd 12 > 9
    stepHostile(e, w, 0.5);
    expect(e.pos.z).toBeGreaterThan(8);
  });

  it('a rifleman under 45% hp with cover available sets cover and holds it for 6 s', () => {
    // Wall at x 2..3 hides the east side of the enemy's surroundings from the player at (0, 20).
    const collision = new CollisionWorld();
    collision.add(box(2, -30, 3, 15));
    const e = makeEnemy('rifle', 0, 0, { engaged: true, hp: 20 });
    const w = makeWorld({ collision, enemies: [e], seed: 7 });
    stepHostile(e, w, 0.1);
    expect(e.cover).not.toBeNull();
    expect(e.coverT).toBeCloseTo(6, 10);
    if (e.cover === null) return;
    const spot = { x: e.cover.x, y: 1.2, z: e.cover.z };
    const target = { x: 0, y: 1.7, z: 20 };
    expect(losClear(target, spot, w) && !smokeBlocks(target, spot, w.smokes)).toBe(false);
  });

  it('a hostile hiding in cover crouches toward 1', () => {
    // A guard at home stays put, so it remains on its cover point while the timer runs.
    const e = makeEnemy('rifle', 0, 0, {
      state: 'guard',
      home: { x: 0, z: 0 },
      cover: { x: 0, z: 0 },
      coverT: 6,
    });
    const w = makeWorld({ player: UNSEEN_PLAYER, enemies: [e] });
    for (let i = 0; i < 5; i += 1) stepHostile(e, w, 0.1);
    expect(e.crouch).toBeGreaterThan(0.9);
  });
});

describe('stepHostile: fire and grenades', () => {
  it('the first sighting spots the player, raises fireT and does not shoot on that tick', () => {
    const e = makeEnemy('rifle', 0, 0);
    const w = makeWorld({ enemies: [e] });
    const events = stepHostile(e, w, 0.1);
    expect(ofType(events, 'spotted')).toHaveLength(1);
    expect(ofType(events, 'spotted')[0]?.by).toBe(e);
    expect(ofType(events, 'shoot')).toHaveLength(0);
    expect(e.engaged).toBe(true);
    expect(e.fireT).toBeGreaterThanOrEqual(0.35);
  });

  it('an engaged enemy seeing the player with fireT 0 emits exactly one shoot and fireT turns positive', () => {
    const e = makeEnemy('rifle', 0, 0, { engaged: true, fireT: 0 });
    const w = makeWorld({ enemies: [e] });
    const events = stepHostile(e, w, 0.1);
    const shots = ofType(events, 'shoot');
    expect(shots).toHaveLength(1);
    expect(shots[0]?.shooter).toBe(e);
    expect(shots[0]?.target).toEqual({ kind: 'player' });
    // Chest aim: pos.y + eyeHeight * 0.6.
    expect(shots[0]?.aim.y).toBeCloseTo(1.7 * 0.6, 10);
    expect(shots[0]?.aim.z).toBe(20);
    expect(e.fireT).toBeGreaterThan(0);
    expect(e.kick).toBeCloseTo(1 - 0.1 * 8, 10);
  });

  it('an operator target is aimed at 0.95 m', () => {
    const e = makeEnemy('rifle', 0, 0, { engaged: true, fireT: 0 });
    const op: Operator = {
      name: 'Op',
      ox: 0,
      oz: 0,
      alive: true,
      hp: 100,
      maxHp: 100,
      pos: { x: 0, z: 10 },
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
    };
    const w = makeWorld({ player: { alive: false }, operators: [op], enemies: [e] });
    const shots = ofType(stepHostile(e, w, 0.1), 'shoot');
    expect(shots).toHaveLength(1);
    expect(shots[0]?.target).toEqual({ kind: 'operator', index: 0 });
    expect(shots[0]?.aim.y).toBe(0.95);
  });

  it('a grenadier at 15 m throws once, then not again until the 9 to 12 s cooldown ends', () => {
    const e = makeEnemy('grenadier', 0, 0, { engaged: true });
    const w = makeWorld({ player: { pos: { x: 0, y: 0, z: 15 } }, enemies: [e] });
    let count = 0;
    let firstWindow = 0;
    for (let tick = 1; tick <= 130; tick += 1) {
      const grenades = ofType(stepHostile(e, w, 0.1), 'grenade');
      for (const g of grenades) {
        expect(g.to).toEqual({ x: 0, z: 15 });
        expect(g.from.y).toBe(1.5);
      }
      count += grenades.length;
      if (tick === 80) firstWindow = count;
    }
    expect(firstWindow).toBe(1);
    expect(count).toBe(2);
  });
});

describe('stepHostile: perception and intel', () => {
  it('smoke between enemy and player stops perception: no spotted event and not engaged', () => {
    const e = makeEnemy('rifle', 0, 0);
    const w = makeWorld({ enemies: [e], smokes: [{ pos: { x: 0, y: 1.6, z: 10 }, r: 2 }] });
    const events = stepHostile(e, w, 0.1);
    expect(ofType(events, 'spotted')).toHaveLength(0);
    expect(e.engaged).toBe(false);
  });

  it('without smoke the same enemy spots the player', () => {
    const e = makeEnemy('rifle', 0, 0);
    const w = makeWorld({ enemies: [e] });
    expect(ofType(stepHostile(e, w, 0.1), 'spotted')).toHaveLength(1);
  });

  it('a spotting enemy alerts hostiles within 18 m and not those beyond', () => {
    const src = makeEnemy('rifle', 0, 0);
    // Short sight so the near and far hostiles do not spot the player themselves.
    const near = makeEnemy('rifle', 10, 0, { state: 'guard', sight: 5 });
    const far = makeEnemy('rifle', 30, 0, { state: 'guard', sight: 5 });
    const w = makeWorld({ enemies: [src, near, far] });
    stepHostile(src, w, 0.1);
    expect(near.state).toBe('hunt');
    expect(near.lastSeen).toEqual({ x: 0, z: 20 });
    expect(far.state).toBe('guard');
    expect(far.lastSeen).toBeNull();
  });

  it('shareIntel skips the source and the dead', () => {
    const src = makeEnemy('rifle', 0, 0, { state: 'guard' });
    const near = makeEnemy('rifle', 10, 0, { state: 'guard' });
    const far = makeEnemy('rifle', 30, 0, { state: 'guard' });
    const dead = makeEnemy('rifle', 5, 0, { state: 'guard', alive: false });
    shareIntel(src, { x: 4, z: 4 }, [src, near, far, dead]);
    expect(src.state).toBe('guard');
    expect(near.state).toBe('hunt');
    expect(near.lastSeen).toEqual({ x: 4, z: 4 });
    expect(far.state).toBe('guard');
    expect(dead.state).toBe('guard');
  });

  it('alertEnemies alerts living hostiles inside the radius only', () => {
    const inside = makeEnemy('rifle', 3, 0, { state: 'guard' });
    const outside = makeEnemy('rifle', 9, 0, { state: 'guard' });
    alertEnemies([inside, outside], 0, 0, 8);
    expect(inside.state).toBe('hunt');
    expect(inside.lastSeen).toEqual({ x: 0, z: 0 });
    expect(outside.state).toBe('guard');
  });

  it('a dead enemy emits nothing and only ticks deathT', () => {
    const e = makeEnemy('rifle', 0, 0, { alive: false, deathT: 2, engaged: true, fireT: 0 });
    const w = makeWorld({ enemies: [e] });
    expect(stepHostile(e, w, 0.5)).toEqual([]);
    expect(e.deathT).toBeCloseTo(1.5, 10);
  });
});

describe('stepHostile: separation and spread', () => {
  it('hostiles settle at 0.9 m apart', () => {
    const e = makeEnemy('rifle', 0, 0, { state: 'guard', home: { x: 0, z: 0 } });
    const other = makeEnemy('rifle', 0.5, 0, { state: 'guard', home: { x: 0.5, z: 0 } });
    const w = makeWorld({ player: UNSEEN_PLAYER, enemies: [e, other] });
    for (let i = 0; i < 40; i += 1) stepHostile(e, w, 0.1);
    expect(Math.hypot(e.pos.x - other.pos.x, e.pos.z - other.pos.z)).toBeCloseTo(0.9, 2);
  });

  it('shotSpread is accuracy plus 0.0022 per metre plus movement terms', () => {
    const shooter = makeEnemy('rifle', 0, 0);
    expect(shotSpread(shooter, 20, false)).toBeCloseTo(0.05 + 20 * 0.0022, 10);
    expect(shotSpread(shooter, 20, true)).toBeCloseTo(0.05 + 20 * 0.0022 + 0.025, 10);
    shooter.moving = true;
    expect(shotSpread(shooter, 20, false)).toBeCloseTo(0.05 + 20 * 0.0022 + 0.03, 10);
  });
});
