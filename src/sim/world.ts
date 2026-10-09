import type { Vec2, Vec3 } from '../core/math';
import type { Rng } from '../core/rng';
import type { DifficultyDef } from '../content/difficulty';
import { ENEMY_DEFS, type EnemyKindId } from '../content/enemies';
import type { Attachment, Perk, WeaponDef } from '../content/weapons';
import { RESPAWN_TIME } from '../content/tuning';
import type { Command } from '../input/commands';
import type { CollisionWorld } from './collision';
import type { AiEvent, AiWorld, Enemy, Operator, Target } from './entities';
import { alertEnemies, stepHostile } from './ai/hostile';
import { GridNav } from './nav/grid';
import type { PathBudget } from './nav/types';
import { damageEnemy, EYE_HEIGHT, nearestEnemyHit, resolveEnemyShot } from './combat';
import { hitDamage } from './ballistics';
import {
  damageOperator,
  damagePlayer,
  hasNearbyOperator,
  killPlayerOrDown,
  PLAYER_MAX_HP,
  passiveRegen,
  respawnSpot,
  revivePlayer,
} from './health';
import { createPlayer, stepPlayer, type PlayerState } from './movement';
import { createOperator, killOperator, operatorAim, placeOperator, updOperator } from './squad';
import { edgeSpawn, enemyTypeForWave, guardLayout, waveTick, type WaveState } from './waves';
import {
  makeWeaponState,
  startReload,
  tickWeapon,
  tryFire,
  type FireResult,
  type WeaponState,
} from './weapons';

// Match simulation: the player, the operator squad, hostiles, waves, enemy grenades and the match
// outcome. One call to step() is one fixed tick. Port of the legacy update() order (index.html:2907-2960)
// and its helpers. No DOM or THREE imports: the render side reads the public fields and the events.

// index.html:2909 (two A* searches per tick).
const PATH_BUDGET_PER_TICK = 2;
// index.html:2194-2195 (guards: sight capped at 26 m; 35% of other spawns flank).
const GUARD_SIGHT_CAP = 26;
const FLANK_CHANCE = 0.35;
// index.html:1823 (pitch clamp after recoil).
const PITCH_LIMIT = 1.45;
// index.html:1831 and 1834 (shot noise: 40 m, or 8 m with a suppressor).
const NOISE_RADIUS = 40;
const SUPPRESSED_RADIUS = 8;
// index.html:2426-2430 (operator fire: eye 1.5, 300 m wall test, tracer cap 200 m, 14 damage, 2x head).
const OPERATOR_EYE_Y = 1.5;
const OPERATOR_WALL_RANGE = 300;
const OPERATOR_TRACER_MAX = 200;
const OPERATOR_DAMAGE = 14;
const OPERATOR_HEAD_MUL = 2;
// index.html:1938-1944 (enemy grenade throw: 1.2 s flight, fuse 0.25 s longer, lob term 8 T^2).
const THROW_T = 1.2;
const THROW_FUSE_EXTRA = 0.25;
const THROW_LOB_Y = 0.3;
const THROW_LOB_G = 8;
// index.html:1945-1965 (grenade flight: gravity 16, floor 0.12, bounces and damping).
const GRENADE_G = 16;
const GRENADE_FLOOR = 0.12;
const GRENADE_BOUNCE = 0.35;
const GRENADE_SIDE_DAMP = 0.6;
const GRENADE_WALL_DAMP = 0.3;
// index.html:1966-1980 (enemy frag: 7 m radius, 80 to the player and 90 to operators, linear falloff).
const FRAG_RADIUS = 7;
const FRAG_PLAYER_DAMAGE = 80;
const FRAG_OPERATOR_DAMAGE = 90;
// index.html:1975 (the player's body for grenade damage is 1 m above the feet).
const PLAYER_GRENADE_Y = 1;
const OPERATOR_GRENADE_Y = 1;
// index.html:866-872 (legacy losClear shortens the ray by 0.05 m).
const LOS_MARGIN = 0.05;
const TAU = Math.PI * 2;

// Zone state the AI reads. Capture is Phase 4, so `captured` stays false for now.
export interface ZoneState {
  x: number;
  z: number;
  captured: boolean;
}

// A rectangle in XZ, as the building footprints of the map (legacy RECTS).
export interface BuildingFootprint {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface SimOptions {
  collision: CollisionWorld;
  // Zone centres, in map order.
  zones: readonly Vec2[];
  // Respawn and ring spawn points from the map (legacy SPAWNS).
  spawns: readonly Vec2[];
  buildings: readonly BuildingFootprint[];
  rng: Rng;
  difficulty: DifficultyDef;
  weapon: WeaponDef;
  attachment: Attachment;
  perk: Perk;
  // ADS blend rate per second (index.html:1728). 17 with Reflex, 12 without.
  adsRate: number;
  playerSpawn: Vec3;
  playerYaw: number;
}

// Player state the sim owns. hp and alive come from PlayerState, the rest are the health record.
export interface PlayerRecord extends PlayerState {
  lastHurt: number;
  downed: boolean;
  bleedT: number;
  // Seconds until respawn while eliminated (legacy P.deathT).
  deathT: number;
}

export interface Grenade {
  pos: Vec3;
  vel: Vec3;
  fuse: number;
}

export type MatchOutcome = 'playing' | 'won' | 'lost';

// Events for the render side and the HUD. Positions are world units.
export type SimEvent =
  | { type: 'playerFire' }
  | {
      type: 'bullet';
      from: Vec3;
      to: Vec3;
      tracer: boolean;
      wall: boolean;
      enemy: Enemy | null;
      head: boolean;
      damage: number;
    }
  | { type: 'enemyShot'; shooter: Enemy; from: Vec3; to: Vec3; tracer: boolean; hit: boolean }
  | { type: 'operatorShot'; operator: Operator; from: Vec3; to: Vec3; enemy: Enemy | null; head: boolean }
  | { type: 'enemyHit'; enemy: Enemy; damage: number; head: boolean; by: 'player' | 'operator' }
  | { type: 'enemyKilled'; enemy: Enemy; by: 'player' | 'operator'; head: boolean }
  | { type: 'spotted'; by: Enemy; target: Target }
  | { type: 'playerHit'; from: Vec2; damage: number }
  | { type: 'playerDown' }
  | { type: 'playerEliminated' }
  | { type: 'playerRevived'; by: string }
  | { type: 'playerRespawn' }
  | { type: 'operatorDown'; operator: Operator }
  | { type: 'wave'; wave: number; spawned: number }
  | { type: 'grenadeThrown'; from: Vec3; to: Vec2 }
  | { type: 'grenadeBlast'; at: Vec3; radius: number }
  | { type: 'orderChanged'; order: 0 | 1 | 2 }
  | { type: 'outcome'; result: 'won' | 'lost' };

export type SimEvents = SimEvent[];

// Squad orders (legacy ORDERS, index.html:473): 0 ATTACK, 1 HOLD, 2 FOLLOW.
const ORDER_COUNT = 3;

export class SimWorld {
  readonly player: PlayerRecord;
  readonly collision: CollisionWorld;
  readonly nav: GridNav;
  readonly rng: Rng;
  readonly zones: ZoneState[];
  weapon: WeaponState;
  enemies: Enemy[] = [];
  operators: Operator[] = [];
  grenades: Grenade[] = [];
  time = 0;
  enemyTickets = 0;
  lives = 0;
  wave: WaveState = { wave: 0, waveT: 0 };
  outcome: MatchOutcome = 'playing';
  order: 0 | 1 | 2 = 0;
  // Counters the debug hook and the HUD read: player shots, bullets that hit a hostile, player kills.
  playerShots = 0;
  playerHits = 0;
  playerKills = 0;

  private readonly zoneCentres: Vec2[];
  private readonly spawn0: Vec2;
  private pathLeft = 0;
  private readonly pathBudget: PathBudget = {
    take: (): boolean => {
      if (this.pathLeft <= 0) return false;
      this.pathLeft -= 1;
      return true;
    },
  };

  constructor(private readonly opts: SimOptions) {
    this.collision = opts.collision;
    this.rng = opts.rng;
    this.nav = new GridNav(opts.collision);
    this.zoneCentres = opts.zones.map((z) => ({ x: z.x, z: z.z }));
    this.zones = this.zoneCentres.map((z) => ({ x: z.x, z: z.z, captured: false }));
    this.spawn0 = opts.spawns[0] ?? { x: opts.playerSpawn.x, z: opts.playerSpawn.z };
    this.player = newPlayerRecord(opts.playerSpawn, opts.playerYaw);
    this.weapon = makeWeaponState(opts.weapon, opts.attachment);
    this.startMatch();
  }

  // Starts a new match on the same map: legacy resetMatch (index.html:2611-2640). Map colliders stay.
  restart(): void {
    this.startMatch();
  }

  // Advances one fixed tick and returns the events it produced. Once the match is over, step does nothing.
  // fireClick is a latched click for this tick (the mouse fire edge); held fire comes from cmd.buttons.
  step(cmd: Command, dt: number, fireClick = false): SimEvents {
    const events: SimEvent[] = [];
    if (this.outcome !== 'playing') return events;
    const p = this.player;
    this.time += dt;
    this.pathLeft = PATH_BUDGET_PER_TICK;

    if (cmd.pressed.has('order')) {
      this.order = ((this.order + 1) % ORDER_COUNT) as 0 | 1 | 2;
      events.push({ type: 'orderChanged', order: this.order });
    }
    stepPlayer(p, cmd, this.collision, dt, {
      lightweight: this.opts.perk === 'lightweight',
      adsRate: this.opts.adsRate,
    });
    if (cmd.pressed.has('reload') && p.alive) startReload(this.weapon, this.opts.perk);

    // Legacy updWeapons (index.html:1841-1854): spread recovers, then a trigger pull fires.
    tickWeapon(this.weapon, dt, cmd.buttons.fire, this.opts.perk);
    const trigger = fireClick || (cmd.buttons.fire && this.weapon.def.auto);
    if (trigger && p.alive && !p.sprinting && p.sprintCool <= 0) {
      const shot = tryFire(this.weapon, {
        ads: cmd.buttons.ads,
        moving: p.moving,
        sprinting: p.sprinting,
        perk: this.opts.perk,
      });
      if (shot !== null) this.fire(shot, events);
    }

    this.stepGrenades(dt, events);

    for (const e of this.enemies) {
      for (const ev of stepHostile(e, this.aiWorld(), dt)) this.onEnemyEvent(ev, events);
    }

    for (const a of this.operators) {
      for (const ev of updOperator(a, this.aiWorld(), dt, { playerDowned: p.downed, spawn: this.spawn0 })) {
        if (ev.type === 'revive') {
          revivePlayer(p);
          events.push({ type: 'playerRevived', by: ev.by.name });
        } else if (ev.type === 'operatorFire') {
          this.operatorFire(ev.operator, ev.enemy, events);
        }
      }
    }

    // Dead hostiles stay for 4 s, then leave the list (legacy index.html:2938-2941).
    this.enemies = this.enemies.filter((e) => e.alive || e.deathT > 0);

    const waveBefore = this.wave.wave;
    const alive = this.enemies.reduce((n, e) => (e.alive ? n + 1 : n), 0);
    const { spawnCount } = waveTick(
      this.wave,
      dt,
      alive,
      this.opts.difficulty,
      this.zones.some((z) => !z.captured),
      this.enemyTickets,
    );
    if (this.wave.wave !== waveBefore)
      events.push({ type: 'wave', wave: this.wave.wave, spawned: spawnCount });
    for (let i = 0; i < spawnCount; i++) this.spawnWaveEnemy();

    // Downed players bleed out; eliminated players respawn after RESPAWN_TIME (legacy index.html:2944-2950).
    if (p.downed) {
      p.bleedT -= dt;
      if (p.bleedT <= 0) {
        p.bleedT = 0;
        this.playerDie(events);
      }
    } else if (!p.alive) {
      p.deathT -= dt;
      if (p.deathT <= 0) this.respawnPlayer(events);
    }
    if (p.alive) p.hp = passiveRegen(p.hp, dt, this.time, p.lastHurt);

    if (this.enemyTickets <= 0) this.end('won', events);
    return events;
  }

  // Resets the match state in place: legacy resetMatch (index.html:2611-2640).
  private startMatch(): void {
    const d = this.opts.difficulty;
    this.time = 0;
    this.outcome = 'playing';
    this.enemyTickets = d.tickets;
    this.lives = d.lives;
    this.wave = { wave: 0, waveT: d.waveT };
    this.order = 0;
    this.playerShots = 0;
    this.playerHits = 0;
    this.playerKills = 0;
    this.grenades = [];
    this.weapon = makeWeaponState(this.opts.weapon, this.opts.attachment);
    Object.assign(this.player, newPlayerRecord(this.opts.playerSpawn, this.opts.playerYaw));
    const base = { x: this.opts.playerSpawn.x, z: this.opts.playerSpawn.z };
    this.operators = ([0, 1] as const).map((i) => createOperator(i, this.rng));
    for (const a of this.operators) placeOperator(a, base, this.collision);
    this.enemies = guardLayout(this.zoneCentres, this.rng).map((g) =>
      createEnemy(g.kind, g.x, g.z, { guard: true, target: null }, this.rng, d),
    );
  }

  // The read-only view the AI steps against. Built per call so the player and squad states are current.
  private aiWorld(): AiWorld {
    const p = this.player;
    return {
      time: this.time,
      player: {
        pos: p.pos,
        eyeHeight: p.eyeHeight,
        alive: p.alive,
        moving: p.moving,
        ghost: this.opts.perk === 'ghost',
        order: this.order,
      },
      enemies: this.enemies,
      operators: this.operators,
      nav: this.nav,
      collision: this.collision,
      smokes: [],
      zones: this.zones,
      rng: this.rng,
      pathBudget: this.pathBudget,
      difficulty: { dmg: this.opts.difficulty.dmg },
    };
  }

  // Open ground for spawns and respawns: no collider within r and no building footprint (legacy openPoint).
  private readonly isOpen = (x: number, z: number, r: number): boolean =>
    this.collision.pointFree(x, z, r) &&
    !this.opts.buildings.some((q) => x > q.x0 - 0.5 && x < q.x1 + 0.5 && z > q.z0 - 0.5 && z < q.z1 + 0.5);

  private onEnemyEvent(ev: AiEvent, events: SimEvent[]): void {
    if (ev.type === 'shoot') {
      this.enemyFire(ev.shooter, ev, events);
    } else if (ev.type === 'grenade') {
      this.throwGrenade(ev.from, ev.to, events);
    } else if (ev.type === 'spotted') {
      events.push({ type: 'spotted', by: ev.by, target: ev.target });
    }
  }

  // Resolves a hostile shot against the player or an operator (legacy enemyShoot, index.html:2222-2243).
  private enemyFire(e: Enemy, ev: Extract<AiEvent, { type: 'shoot' }>, events: SimEvent[]): void {
    const p = this.player;
    const from: Vec3 = { x: e.pos.x, y: EYE_HEIGHT, z: e.pos.z };
    if (ev.target.kind === 'player') {
      const r = resolveEnemyShot(
        e,
        ev,
        p.pos,
        true,
        this.collision,
        this.rng,
        this.opts.difficulty,
        p.eyeHeight,
      );
      events.push({ type: 'enemyShot', shooter: e, from, to: r.end, tracer: r.tracer, hit: r.hit });
      if (!r.hit) return;
      events.push({ type: 'playerHit', from: { x: e.pos.x, z: e.pos.z }, damage: r.damage });
      if (damagePlayer(p, r.damage, this.time).killed) this.onPlayerKilled(events);
      return;
    }
    const a = this.operators[ev.target.index];
    if (a === undefined || !a.alive) return;
    const target: Vec3 = { x: a.pos.x, y: 0, z: a.pos.z };
    const r = resolveEnemyShot(
      e,
      ev,
      target,
      false,
      this.collision,
      this.rng,
      this.opts.difficulty,
      p.eyeHeight,
    );
    events.push({ type: 'enemyShot', shooter: e, from, to: r.end, tracer: r.tracer, hit: r.hit });
    if (!r.hit) return;
    if (damageOperator(a, r.damage).killed) {
      killOperator(a);
      events.push({ type: 'operatorDown', operator: a });
    }
  }

  // Operator fire at an enemy (legacy allyFire, index.html:2424-2435). The first enemy on the ray takes the hit.
  private operatorFire(a: Operator, target: Enemy, events: SimEvent[]): void {
    const eye: Vec3 = { x: a.pos.x, y: OPERATOR_EYE_Y, z: a.pos.z };
    const dir = operatorAim(a, target, this.rng);
    const wall = this.collision.raycast(eye, dir, OPERATOR_WALL_RANGE)?.t ?? Infinity;
    const hit = nearestEnemyHit(eye, dir, wall, this.enemies);
    const endT = hit !== null ? hit.t : Math.min(wall, OPERATOR_TRACER_MAX);
    events.push({
      type: 'operatorShot',
      operator: a,
      from: eye,
      to: at(eye, dir, endT),
      enemy: hit?.enemy ?? null,
      head: hit?.head ?? false,
    });
    if (hit === null) return;
    const dmg = OPERATOR_DAMAGE * (hit.head ? OPERATOR_HEAD_MUL : 1);
    this.hurtEnemy(hit.enemy, dmg, hit.head, a, events);
  }

  // Player shot: recoil, then one ray per pellet (legacy fire, index.html:1809-1837).
  private fire(shot: FireResult, events: SimEvent[]): void {
    const p = this.player;
    const def = this.weapon.def;
    const steady = this.opts.perk === 'steady' ? 0.7 : 1;
    const adsMul = p.adsT > 0.5 ? 0.55 : 1;
    this.playerShots += 1;
    events.push({ type: 'playerFire' });

    p.pitch = clamp(p.pitch + def.recoil * adsMul * shot.recoilMul, -PITCH_LIMIT, PITCH_LIMIT);
    p.yaw += (this.rng.next() * 2 - 1) * def.recoilYaw * steady;

    const eye: Vec3 = { x: p.pos.x, y: p.pos.y + p.eyeHeight, z: p.pos.z };
    const cp = Math.cos(p.pitch);
    const base: Vec3 = { x: Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: Math.cos(p.yaw) * cp };
    for (let i = 0; i < shot.pellets; i++) {
      const dx = base.x + (this.rng.next() * 2 - 1) * shot.spread;
      const dy = base.y + (this.rng.next() * 2 - 1) * shot.spread;
      const dz = base.z;
      const n = Math.hypot(dx, dy, dz);
      this.bullet(eye, { x: dx / n, y: dy / n, z: dz / n }, i === 0, events);
    }
    alertEnemies(this.enemies, p.pos.x, p.pos.z, this.weapon.noisy ? NOISE_RADIUS : SUPPRESSED_RADIUS);
  }

  // One ray: the first hostile before the first wall takes damage (legacy bullet, index.html:1855-1880).
  private bullet(eye: Vec3, dir: Vec3, tracer: boolean, events: SimEvent[]): void {
    const range = this.weapon.def.range;
    const wallT = this.collision.raycast(eye, dir, range)?.t ?? Infinity;
    const limit = Math.min(wallT, range);
    const hit = nearestEnemyHit(eye, dir, limit, this.enemies);
    if (hit === null) {
      events.push({
        type: 'bullet',
        from: eye,
        to: at(eye, dir, limit),
        tracer,
        wall: Number.isFinite(wallT),
        enemy: null,
        head: false,
        damage: 0,
      });
      return;
    }
    // Falloff and headshot multipliers from ballistics.ts (legacy index.html:1872-1876).
    const dealt = hitDamage(this.weapon.def, hit.t, hit.head);
    events.push({
      type: 'bullet',
      from: eye,
      to: at(eye, dir, hit.t),
      tracer,
      wall: false,
      enemy: hit.enemy,
      head: hit.head,
      damage: dealt,
    });
    this.playerHits += 1;
    this.hurtEnemy(hit.enemy, dealt, hit.head, 'player', events);
  }

  // Applies damage to a hostile and books the kill. The attacker is the player or the operator who shot.
  private hurtEnemy(
    e: Enemy,
    dmg: number,
    head: boolean,
    attacker: Operator | 'player',
    events: SimEvent[],
  ): void {
    const by = attacker === 'player' ? 'player' : 'operator';
    const r = damageEnemy(e, dmg, head, by);
    // Legacy damageEnemy sets lastSeen to the player's position, whoever fired.
    e.lastSeen = { x: this.player.pos.x, z: this.player.pos.z };
    events.push({ type: 'enemyHit', enemy: e, damage: dmg, head, by });
    if (!r.killed) return;
    this.enemyTickets = Math.max(0, this.enemyTickets - r.ticketDelta);
    if (attacker === 'player') this.playerKills += 1;
    else attacker.kills += 1;
    events.push({ type: 'enemyKilled', enemy: e, by, head });
  }

  // Downs the player when a squadmate is near, otherwise eliminates them (legacy killPlayer, index.html:1629-1641).
  // The legacy also clears the slide and the vault, as done here.
  private onPlayerKilled(events: SimEvent[]): void {
    const p = this.player;
    p.sliding = 0;
    p.vault = null;
    const nearby = hasNearbyOperator(p.pos, this.operators);
    if (killPlayerOrDown(p, nearby) === 'down') {
      events.push({ type: 'playerDown' });
      return;
    }
    this.playerDie(events);
  }

  // Legacy playerDie (index.html:1642-1657): spends a reinforcement, or ends the match when none are left.
  private playerDie(events: SimEvent[]): void {
    const p = this.player;
    p.downed = false;
    events.push({ type: 'playerEliminated' });
    if (this.lives <= 0) {
      this.end('lost', events);
      return;
    }
    this.lives -= 1;
    p.deathT = RESPAWN_TIME;
  }

  // Legacy respawnPlayer (index.html:1658-1679): on a squadmate when clear, else the far spawn.
  private respawnPlayer(events: SimEvent[]): void {
    const p = this.player;
    const spot = respawnSpot(this.operators, this.enemies, this.opts.spawns, this.isOpen);
    p.pos.x = spot.x;
    p.pos.y = 0;
    p.pos.z = spot.z;
    p.vel = { x: 0, y: 0, z: 0 };
    p.vy = 0;
    p.onGround = true;
    p.sliding = 0;
    p.vault = null;
    p.hp = PLAYER_MAX_HP;
    p.alive = true;
    p.stamina = 1;
    p.yaw = Math.atan2(-spot.x, -spot.z);
    p.pitch = 0;
    events.push({ type: 'playerRespawn' });
  }

  // A wave spawn at the ring, heading for the nearest open zone (legacy updWaves, index.html:2379-2387).
  private spawnWaveEnemy(): void {
    const pos = edgeSpawn(this.rng, this.isOpen);
    const target = openZoneFrom(pos, this.zones);
    const kind = enemyTypeForWave(this.wave.wave, this.rng.next());
    this.enemies.push(
      createEnemy(kind, pos.x, pos.z, { guard: false, target }, this.rng, this.opts.difficulty),
    );
  }

  // Ends the match once. A loss earlier in the same tick keeps its result.
  private end(result: 'won' | 'lost', events: SimEvent[]): void {
    if (this.outcome !== 'playing') return;
    this.outcome = result;
    events.push({ type: 'outcome', result });
  }

  // Enemy frag: a throw at the player's position (legacy enemyThrow, index.html:1938-1944).
  private throwGrenade(from: Vec3, to: Vec2, events: SimEvent[]): void {
    const start: Vec3 = { x: from.x, y: from.y, z: from.z };
    const vel: Vec3 = {
      x: (to.x - start.x) / THROW_T,
      y: (THROW_LOB_Y - start.y + THROW_LOB_G * THROW_T * THROW_T) / THROW_T,
      z: (to.z - start.z) / THROW_T,
    };
    this.grenades.push({ pos: { ...start }, vel, fuse: THROW_T + THROW_FUSE_EXTRA });
    events.push({ type: 'grenadeThrown', from: start, to: { x: to.x, z: to.z } });
  }

  // Grenade flight and fuse (legacy updGrenades, index.html:1945-1965).
  private stepGrenades(dt: number, events: SimEvent[]): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (g === undefined) continue;
      g.vel.y -= GRENADE_G * dt;
      const old = { ...g.pos };
      g.pos.x += g.vel.x * dt;
      g.pos.y += g.vel.y * dt;
      g.pos.z += g.vel.z * dt;
      if (g.pos.y < GRENADE_FLOOR) {
        g.pos.y = GRENADE_FLOOR;
        g.vel.y *= -GRENADE_BOUNCE;
        g.vel.x *= GRENADE_SIDE_DAMP;
        g.vel.z *= GRENADE_SIDE_DAMP;
      }
      if (this.insideCollider(g.pos)) {
        g.pos = old;
        g.vel.x *= -GRENADE_WALL_DAMP;
        g.vel.z *= -GRENADE_WALL_DAMP;
      }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        this.explode(g.pos, events);
        this.grenades.splice(i, 1);
      }
    }
  }

  // Legacy explodeGrenade for an enemy frag (index.html:1966-1981).
  private explode(at0: Vec3, events: SimEvent[]): void {
    events.push({ type: 'grenadeBlast', at: { ...at0 }, radius: FRAG_RADIUS });
    const p = this.player;
    if (p.alive) {
      const pc: Vec3 = { x: p.pos.x, y: p.pos.y + PLAYER_GRENADE_Y, z: p.pos.z };
      const dd = dist3(at0, pc);
      if (dd < FRAG_RADIUS && this.clearLine(at0, pc)) {
        const dmg = FRAG_PLAYER_DAMAGE * this.opts.difficulty.dmg * (1 - dd / FRAG_RADIUS);
        events.push({ type: 'playerHit', from: { x: at0.x, z: at0.z }, damage: dmg });
        if (damagePlayer(p, dmg, this.time).killed) this.onPlayerKilled(events);
      }
    }
    for (const a of this.operators) {
      if (!a.alive) continue;
      const ac: Vec3 = { x: a.pos.x, y: OPERATOR_GRENADE_Y, z: a.pos.z };
      const dd = dist3(at0, ac);
      if (dd < FRAG_RADIUS && this.clearLine(at0, ac)) {
        if (damageOperator(a, FRAG_OPERATOR_DAMAGE * (1 - dd / FRAG_RADIUS)).killed) {
          killOperator(a);
          events.push({ type: 'operatorDown', operator: a });
        }
      }
    }
  }

  private insideCollider(p: Vec3): boolean {
    return this.collision
      .footprints()
      .some((c) => p.x > c.min.x && p.x < c.max.x && p.z > c.min.z && p.z < c.max.z && p.y < c.max.y);
  }

  // Legacy losClear (index.html:866-872): no collider between a and b, ignoring the last 0.05 m.
  private clearLine(a: Vec3, b: Vec3): boolean {
    const dist = dist3(a, b);
    if (dist < 0.01) return true;
    const dir: Vec3 = { x: (b.x - a.x) / dist, y: (b.y - a.y) / dist, z: (b.z - a.z) / dist };
    return this.collision.raycast(a, dir, dist - LOS_MARGIN) === null;
  }
}

function newPlayerRecord(spawn: Vec3, yaw: number): PlayerRecord {
  return { ...createPlayer(spawn, yaw), lastHurt: -99, downed: false, bleedT: 0, deathT: 0 };
}

// Hostile with the legacy spawn fields (index.html:2185-2206). Guards are capped at 26 m of sight.
function createEnemy(
  kind: EnemyKindId,
  x: number,
  z: number,
  opts: { guard: boolean; target: Vec2 | null },
  rng: Rng,
  difficulty: DifficultyDef,
): Enemy {
  const def = ENEMY_DEFS[kind];
  const hp = def.hp * difficulty.hp;
  const guard = opts.guard;
  const target = opts.target;
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
    yaw: rng.next() * TAU,
    state: guard ? 'guard' : 'hunt',
    home: guard ? { x, z } : null,
    lastSeen: target !== null ? { x: target.x, z: target.z } : null,
    sight: guard ? Math.min(def.sight, GUARD_SIGHT_CAP) : def.sight,
    role: !guard && rng.next() < FLANK_CHANCE ? 'flank' : 'push',
    flankSide: rng.next() < 0.5 ? -1 : 1,
    fireT: rng.next() * 0.5,
    blind: 0,
    coverT: 0,
    grenT: rng.next() * 3,
    cover: null,
    engaged: false,
    unseenT: 0,
    flinchT: 0,
    strafeT: 1,
    strafeDir: rng.next() < 0.5 ? -1 : 1,
    moving: false,
    phase: rng.next() * 6,
    deathT: 0,
    spot: 0,
    gx: (rng.next() - 0.5) * 5,
    gz: (rng.next() - 0.5) * 5,
    kick: 0,
    crouch: 0,
  };
}

// Nearest zone that is not captured (legacy openZoneFrom, index.html:2162-2170).
function openZoneFrom(p: Vec2, zones: readonly ZoneState[]): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const z of zones) {
    if (z.captured) continue;
    const d = (p.x - z.x) ** 2 + (p.z - z.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { x: z.x, z: z.z };
    }
  }
  return best;
}

function at(o: Vec3, d: Vec3, t: number): Vec3 {
  return { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
