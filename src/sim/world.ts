import type { Vec2, Vec3 } from '../core/math';
import type { Rng } from '../core/rng';
import type { DifficultyDef } from '../content/difficulty';
import { ENEMY_DEFS, type EnemyKindId } from '../content/enemies';
import type { Action, GadgetId } from '../content/ids';
import { AIRSTRIKE_AIM_DIST, type KillstreakId } from '../content/killstreaks';
import type { Attachment, Perk, WeaponDef } from '../content/weapons';
import { RESPAWN_TIME } from '../content/tuning';
import type { Command } from '../input/commands';
import type { BoxId, CollisionWorld } from './collision';
import type { AiEvent, AiWorld, Enemy, Operator, Target } from './entities';
import { alertEnemies, stepHostile } from './ai/hostile';
import { GridNav } from './nav/grid';
import type { PathBudget } from './nav/types';
import {
  damageEnemy,
  EYE_HEIGHT,
  HEADSHOT_BONUS,
  KILL_SCORE,
  nearestEnemyHit,
  resolveEnemyShot,
} from './combat';
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
import { applyKill, applyZoneCapture, matchOutcome, type TicketState } from './tickets';
import { createZone, updateZones, ZONE_CAPTURE_SCORE, type Zone } from './objectives';
import { endMatch, type MatchOver, type MatchResult, type MatchSummaryInput, type MatchState } from './match';
import {
  awardKillstreak,
  createUav,
  spendKillstreak,
  stepUav,
  takeKillstreak,
  type KillstreakSlot,
  type UavState,
} from './killstreaks';
import { placeSentry, stepTurrets, type Turret } from './turret';
import { createAirstrike, stepAirstrike, type AirstrikeState } from './airstrike';
import { createGadgetSlot, useGadget, type GadgetSlot } from './gadgets';
import {
  FRAG_RADIUS,
  makeGrenade,
  stepGrenades,
  stepSmokes,
  type Grenade,
  type GrenadeContext,
  type GrenadeEvent,
  type SmokeCloud,
} from './grenades';
import { BLAST_RADIUS, createBreach, plantBreach, stepBreach, type BreachState } from './breach';
import { stepDrone, type DroneState } from './drone';
import { createCrates, nearestCrate, resupply, stepCrates, type CrateState } from './resupply';

// Match simulation: the player, the operator squad, hostiles, waves, grenades, smokes, gadgets, breach charges,
// crates, killstreaks, the zones, tickets and the match outcome. One call to step() is one fixed tick. Port of the
// legacy update() order (index.html:2907-2960) and its helpers. No DOM or THREE imports: the render side reads the
// public fields and the events.

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
// index.html:1303-1310 (groundAim): a downward aim reaches at most 1.5 times the requested distance; a level or
// upward aim uses a point 8 m ahead.
const GROUND_AIM_REACH = 1.5;
const GROUND_AIM_LEVEL_DIST = 8;
const GROUND_AIM_DOWN_LIMIT = -0.05;
// index.html:473 (squad orders: 0 ATTACK, 1 HOLD, 2 FOLLOW).
const ORDER_COUNT = 3;
const TAU = Math.PI * 2;

// A rectangle in XZ, as the building footprints of the map (legacy RECTS).
export interface BuildingFootprint {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

// A capture zone as the map defines it. The name is shown in the feed (legacy ZONES entries).
export interface ZoneDef {
  name: string;
  x: number;
  z: number;
}

export interface SimOptions {
  collision: CollisionWorld;
  // Capture zones, in map order.
  zones: readonly ZoneDef[];
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
  // The two loadout gadgets, slot 0 and slot 1 (legacy P.gadgets).
  gadgets: readonly [GadgetId, GadgetId];
  // Resupply crate positions (legacy crates array, MapHandle.pickups).
  crates: readonly Vec2[];
  // Map display name, used in the debrief line.
  mapName: string;
}

// Player state the sim owns. hp and alive come from PlayerState, the rest are the health record.
export interface PlayerRecord extends PlayerState {
  lastHurt: number;
  downed: boolean;
  bleedT: number;
  // Seconds until respawn while eliminated (legacy P.deathT). Zero when no respawn is pending.
  deathT: number;
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
  | { type: 'zoneCaptured'; name: string; playerBonus: boolean }
  | { type: 'killstreakEarned'; id: KillstreakId }
  | { type: 'killstreakUsed'; id: KillstreakId }
  | { type: 'sentryNoGround' }
  | { type: 'turretShot'; from: Vec3; to: Vec3; hit: boolean }
  | { type: 'airstrikeBlast'; at: Vec3; radius: number }
  | { type: 'breachBlast'; at: Vec3; radius: number; box: BoxId }
  | { type: 'resupplied' }
  | { type: 'playerFlashed'; seconds: number }
  | { type: 'matchEnd'; result: MatchResult };

export type SimEvents = SimEvent[];

export class SimWorld {
  readonly player: PlayerRecord;
  readonly collision: CollisionWorld;
  readonly nav: GridNav;
  readonly rng: Rng;
  // Capture zones in map order (objectives.ts). Their captured flags feed the AI and the waves.
  readonly zones: Zone[];
  weapon: WeaponState;
  enemies: Enemy[] = [];
  operators: Operator[] = [];
  // Grenades in flight (player and enemy) and smoke clouds. Smoke blocks sight and fire.
  grenades: Grenade[] = [];
  smokes: SmokeCloud[] = [];
  // Killstreak effects in play: sentry turrets, airstrikes in progress, the UAV clock and the recon drone.
  turrets: Turret[] = [];
  airstrikes: AirstrikeState[] = [];
  uav: UavState = { t: 0 };
  drone: DroneState | null = null;
  // Breach charges and the armed plant; resupply crates; the two loadout gadgets.
  breach: BreachState = createBreach();
  gadgets: GadgetSlot[] = [];
  crates: CrateState[] = [];
  // The killstreak held for H (legacy P.ks) and killstreaks used (legacy P.ksUsed).
  killstreak: KillstreakSlot = { ks: null, ksUsed: 0 };
  time = 0;
  // Reinforcements left (legacy P.lives).
  lives = 0;
  wave: WaveState = { wave: 0, waveT: 0 };
  order: 0 | 1 | 2 = 0;
  // Seconds of player blindness left from a flashbang (legacy P.flashT).
  flashT = 0;
  // Score and the player's record for the debrief (legacy P.score, P.kills, P.deaths, P.streak).
  score = 0;
  deaths = 0;
  streak = 0;
  // Counters the debug hook and the HUD read: player shots, bullets that hit a hostile, player kills.
  playerShots = 0;
  playerHits = 0;
  playerKills = 0;

  private readonly tickets: TicketState = { enemyTickets: 0, startTickets: 0 };
  // play until the match ends; then the result is kept (endMatch is idempotent).
  private matchState: Exclude<MatchState, 'over'> | MatchOver = 'play';
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
    this.zones = opts.zones.map((z) => createZone(z));
    this.spawn0 = opts.spawns[0] ?? { x: opts.playerSpawn.x, z: opts.playerSpawn.z };
    this.player = newPlayerRecord(opts.playerSpawn, opts.playerYaw);
    this.weapon = makeWeaponState(opts.weapon, opts.attachment);
    this.resetMatch();
  }

  // Starts a new match on the same map: legacy resetMatch (index.html:2611-2640). Map colliders stay.
  restart(): void {
    this.resetMatch();
  }

  // Enemy tickets left. The win condition is this reaching 0.
  get enemyTickets(): number {
    return this.tickets.enemyTickets;
  }

  // The match result once the match has ended, or null while it runs.
  get result(): MatchResult | null {
    return typeof this.matchState === 'object' ? this.matchState.result : null;
  }

  get outcome(): MatchOutcome {
    const r = this.result;
    if (r === null) return 'playing';
    return r.win ? 'won' : 'lost';
  }

  // Hostiles revealed right now: alive and with a spot above zero (UAV or drone). For the HUD.
  get spotted(): readonly Enemy[] {
    return this.enemies.filter((e) => e.alive && e.spot > 0);
  }

  // Debug seam only (the ?debug hook): sets the enemy ticket pool, so the win can be reached without play.
  forceEnemyTickets(n: number): void {
    this.tickets.enemyTickets = n;
  }

  // Advances one fixed tick and returns the events it produced. Once the match is over, step does nothing.
  // fireClick is a latched click for this tick (the mouse fire edge); held fire comes from cmd.buttons.fire.
  step(cmd: Command, dt: number, fireClick = false): SimEvents {
    const events: SimEvent[] = [];
    if (this.result !== null) return events;
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
    this.handlePresses(cmd.pressed, events);

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

    this.stepThrown(dt, events);
    this.stepBreachCharge(dt, events);
    stepUav(this.uav, this.enemies, dt);
    if (this.drone !== null) this.drone = stepDrone(this.drone, dt, this.enemies);
    this.stepSentries(dt, events);
    this.stepAirstrikes(dt, events);
    stepCrates(this.crates, dt);
    this.flashT = Math.max(0, this.flashT - dt);

    for (const e of this.enemies) {
      for (const ev of stepHostile(e, this.aiWorld(), dt)) this.onEnemyEvent(ev, events);
    }

    for (const a of this.operators) {
      for (const ev of updOperator(a, this.aiWorld(), dt, { playerDowned: p.downed, spawn: this.spawn0 })) {
        if (ev.type === 'revive') {
          this.score += revivePlayer(p).scoreDelta;
          events.push({ type: 'playerRevived', by: ev.by.name });
        } else if (ev.type === 'operatorFire') {
          this.operatorFire(ev.operator, ev.enemy, events);
        }
      }
    }

    // Dead hostiles stay for 4 s, then leave the list (legacy index.html:2938-2941).
    this.enemies = this.enemies.filter((e) => e.alive || e.deathT > 0);

    this.stepZones(dt, events);

    const waveBefore = this.wave.wave;
    const alive = this.enemies.reduce((n, e) => (e.alive ? n + 1 : n), 0);
    const { spawnCount } = waveTick(
      this.wave,
      dt,
      alive,
      this.opts.difficulty,
      this.zones.some((z) => !z.captured),
      this.tickets.enemyTickets,
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
    } else if (!p.alive && p.deathT > 0) {
      p.deathT -= dt;
      if (p.deathT <= 0) this.respawnPlayer(events);
    }
    if (p.alive) p.hp = passiveRegen(p.hp, dt, this.time, p.lastHurt);

    this.checkOutcome(events);
    return events;
  }

  // Resets the match state in place: legacy resetMatch (index.html:2611-2640).
  private resetMatch(): void {
    const d = this.opts.difficulty;
    this.time = 0;
    this.tickets.enemyTickets = d.tickets;
    this.tickets.startTickets = d.tickets;
    this.lives = d.lives;
    this.wave = { wave: 0, waveT: d.waveT };
    this.order = 0;
    this.flashT = 0;
    this.score = 0;
    this.deaths = 0;
    this.streak = 0;
    this.playerShots = 0;
    this.playerHits = 0;
    this.playerKills = 0;
    this.grenades = [];
    this.smokes = [];
    this.turrets = [];
    this.airstrikes = [];
    this.uav = { t: 0 };
    this.drone = null;
    this.breach = createBreach();
    this.gadgets = this.opts.gadgets.map((id) => createGadgetSlot(id));
    this.crates = createCrates(this.opts.crates);
    this.killstreak = { ks: null, ksUsed: 0 };
    for (const z of this.zones) {
      z.prog = 0;
      z.captured = false;
      z.status = 'idle';
    }
    this.matchState = 'play';
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
      smokes: this.smokes,
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
      if (r.hit) this.damagePlayerFrom(e.pos, r.damage, events);
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
    const base = this.aimDir();
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

  // Applies a weapon hit to a hostile. The attacker is the player or the operator who shot.
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
    if (attacker !== 'player') attacker.kills += 1;
    this.onEnemyKilled(e, by, head, events);
  }

  // Books one hostile death. Every kill costs the enemy a ticket (tickets.ts). For the player's kills, the count,
  // the score (kill 100, headshot +50) and the streak go up, and a killstreak is awarded at 3, 5 and 7 in a row.
  private onEnemyKilled(e: Enemy, by: 'player' | 'operator', head: boolean, events: SimEvent[]): void {
    applyKill(this.tickets);
    if (by === 'player') {
      this.playerKills += 1;
      this.streak += 1;
      this.score += KILL_SCORE + (head ? HEADSHOT_BONUS : 0);
      const held = this.killstreak.ks;
      this.killstreak = awardKillstreak(this.killstreak, this.streak);
      if (this.killstreak.ks !== null && this.killstreak.ks !== held) {
        events.push({ type: 'killstreakEarned', id: this.killstreak.ks });
      }
    }
    events.push({ type: 'enemyKilled', enemy: e, by, head });
  }

  // Applies damage to the player from a hit at `from` (a hostile, a blast centre). Eliminates or downs the player
  // when hp runs out.
  private damagePlayerFrom(from: Vec2, damage: number, events: SimEvent[]): void {
    const p = this.player;
    if (!p.alive || damage <= 0) return;
    events.push({ type: 'playerHit', from: { x: from.x, z: from.z }, damage });
    if (damagePlayer(p, damage, this.time).killed) this.onPlayerKilled(events);
  }

  // Downs the player when a squadmate is near, otherwise eliminates them (legacy killPlayer, index.html:1629-1641).
  // The legacy also clears the slide, the vault and any armed breach charge, as done here.
  private onPlayerKilled(events: SimEvent[]): void {
    const p = this.player;
    p.sliding = 0;
    p.vault = null;
    this.breach.plant = null;
    const nearby = hasNearbyOperator(p.pos, this.operators);
    if (killPlayerOrDown(p, nearby) === 'down') {
      events.push({ type: 'playerDown' });
      return;
    }
    this.playerDie(events);
  }

  // Legacy playerDie (index.html:1642-1657): counts the death, clears the streak and the held killstreak, and
  // spends a reinforcement. With no reinforcements left the player stays down (deathT zero) and checkOutcome ends the
  // match this tick.
  private playerDie(events: SimEvent[]): void {
    const p = this.player;
    p.downed = false;
    p.deathT = 0;
    this.deaths += 1;
    this.streak = 0;
    this.killstreak = { ks: null, ksUsed: this.killstreak.ksUsed };
    events.push({ type: 'playerEliminated' });
    if (this.lives <= 0) return;
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

  // Ends the match once the outcome is decided (tickets.ts matchOutcome). Loss is checked first (legacy playerDie
  // before the win check). A dead player with no reinforcement and no respawn pending is a loss.
  private checkOutcome(events: SimEvent[]): void {
    const p = this.player;
    const playerDead = !p.alive && !p.downed && p.deathT <= 0;
    const outcome = matchOutcome(this.tickets, this.zones, this.lives, playerDead);
    if (outcome === 'continue') return;
    const ended = endMatch(this.matchState, outcome === 'win', this.summary());
    this.matchState = ended;
    events.push({ type: 'matchEnd', result: ended.result });
  }

  private summary(): MatchSummaryInput {
    return {
      score: this.score,
      kills: this.playerKills,
      deaths: this.deaths,
      zonesCaptured: this.zones.filter((z) => z.captured).length,
      zonesTotal: this.zones.length,
      seconds: this.time,
      mapName: this.opts.mapName,
      difficulty: this.opts.difficulty.name,
    };
  }

  // Zone capture (objectives.ts). A capture costs the enemy tickets (tickets.ts); the player earns the bonus when
  // they are inside at the capture. A zone counts a friendly when the living player or an operator is inside, and
  // a hostile when a living enemy is inside.
  private stepZones(dt: number, events: SimEvent[]): void {
    const p = this.player;
    const playerIn = (z: Zone): boolean => p.alive && within(p.pos, z);
    const { captures } = updateZones(
      {
        zones: this.zones,
        playerInside: playerIn,
        operatorInside: (z) => this.operators.some((a) => a.alive && within(a.pos, z)),
        enemyInside: (z) => this.enemies.some((e) => e.alive && within(e.pos, z)),
        playerInsideAtCapture: playerIn,
      },
      dt,
    );
    for (const c of captures) {
      applyZoneCapture(this.tickets);
      if (c.playerBonus) this.score += ZONE_CAPTURE_SCORE;
      events.push({ type: 'zoneCaptured', name: c.zone.name, playerBonus: c.playerBonus });
    }
  }

  // Enemy frag: a throw at the player's position (legacy enemyThrow, index.html:1938-1944).
  private throwGrenade(from: Vec3, to: Vec2, events: SimEvent[]): void {
    const start: Vec3 = { x: from.x, y: from.y, z: from.z };
    const vel: Vec3 = {
      x: (to.x - start.x) / THROW_T,
      y: (THROW_LOB_Y - start.y + THROW_LOB_G * THROW_T * THROW_T) / THROW_T,
      z: (to.z - start.z) / THROW_T,
    };
    this.grenades.push(makeGrenade('enemy', 'frag', start, vel, THROW_T + THROW_FUSE_EXTRA));
    events.push({ type: 'grenadeThrown', from: start, to: { x: to.x, z: to.z } });
  }

  // Grenade flight and fuses, then smoke ageing (grenades.ts stepGrenades and stepSmokes). The player's and the
  // enemies' grenades share this step.
  private stepThrown(dt: number, events: SimEvent[]): void {
    const p = this.player;
    const ctx: GrenadeContext = {
      world: this.collision,
      enemies: this.enemies,
      operators: this.operators,
      smokes: this.smokes,
      player: { pos: p.pos, eye: this.eye(), aim: this.aimDir(), alive: p.alive },
      difficulty: { dmg: this.opts.difficulty.dmg },
    };
    for (const ev of stepGrenades(this.grenades, dt, ctx)) this.onGrenadeEvent(ev, events);
    stepSmokes(this.smokes, dt);
  }

  // Applies one explosion: the player's damage and flash, the kills it made, and the events for the render side.
  private onGrenadeEvent(ev: GrenadeEvent, events: SimEvent[]): void {
    if (ev.kind === 'frag') events.push({ type: 'grenadeBlast', at: ev.pos, radius: FRAG_RADIUS });
    if (ev.playerFlashT > 0) {
      this.flashT = Math.max(this.flashT, ev.playerFlashT);
      events.push({ type: 'playerFlashed', seconds: ev.playerFlashT });
    }
    if (ev.playerDamage > 0) this.damagePlayerFrom(ev.pos, ev.playerDamage, events);
    for (const e of ev.enemyKills) this.onEnemyKilled(e, 'player', false, events);
    for (const a of ev.operatorKills) {
      killOperator(a);
      events.push({ type: 'operatorDown', operator: a });
    }
  }

  // The armed breach charge (breach.ts stepBreach). A detonation removes the wall from the collision world, so the
  // nav grid is rebuilt (legacy breakWall, index.html:2093-2105).
  private stepBreachCharge(dt: number, events: SimEvent[]): void {
    const armed = this.breach.plant;
    const step = stepBreach(this.breach, dt, this.collision, this.enemies, this.player.pos);
    if (!step.exploded) return;
    if (step.brokenBox !== undefined) this.nav.rebuild();
    if (armed !== null) {
      events.push({ type: 'breachBlast', at: armed.point, radius: BLAST_RADIUS, box: armed.box });
    }
    for (const e of step.enemyKills) this.onEnemyKilled(e, 'player', false, events);
    if (step.playerDamage > 0) this.damagePlayerFrom(this.player.pos, step.playerDamage, events);
  }

  // Sentry turrets fire and expire (turret.ts stepTurrets). Kills and damage go through the same bookkeeping as
  // the player's shots.
  private stepSentries(dt: number, events: SimEvent[]): void {
    const shots = stepTurrets(this.turrets, this.enemies, this.collision, this.smokes, this.rng, dt);
    for (const s of shots) {
      events.push({ type: 'turretShot', from: s.from, to: s.to, hit: s.hitEnemy !== null });
      const e = s.hitEnemy;
      if (e === null) continue;
      events.push({ type: 'enemyHit', enemy: e, damage: s.damage, head: s.head, by: 'player' });
      if (s.killed) this.onEnemyKilled(e, 'player', s.head, events);
    }
  }

  // Airstrikes in progress (airstrike.ts stepAirstrike). Finished strikes are removed.
  private stepAirstrikes(dt: number, events: SimEvent[]): void {
    for (const s of this.airstrikes) {
      const p = this.player;
      const step = stepAirstrike(s, dt, this.enemies, this.collision, this.rng, p.alive ? p.pos : null);
      for (const b of step.blasts) events.push({ type: 'airstrikeBlast', at: b.at, radius: b.radius });
      for (const e of step.enemyKills) this.onEnemyKilled(e, 'player', false, events);
      if (step.playerDamage > 0) this.damagePlayerFrom(p.pos, step.playerDamage, events);
    }
    this.airstrikes = this.airstrikes.filter((s) => !s.done);
  }

  // Loadout gadget presses (legacy gadget1, gadget2, interact, killstreak). Gadgets and the killstreak act on the
  // sim step, so a press is consumed by the tick that reads it.
  private handlePresses(pressed: ReadonlySet<Action>, events: SimEvent[]): void {
    if (pressed.has('gadget1')) this.useGadgetSlot(0);
    if (pressed.has('gadget2')) this.useGadgetSlot(1);
    if (pressed.has('interact')) this.interact(events);
    if (pressed.has('killstreak')) this.useKillstreak(events);
  }

  // Uses a loadout gadget (gadgets.ts useGadget). Grenades join the flight list, the drone is stored until it ends.
  private useGadgetSlot(index: 0 | 1): void {
    const r = useGadget(this.gadgets, index, this.player, this.eye(), this.aimDir(), this.drone);
    if (!r.used) return;
    if (r.kind === 'grenade') this.grenades.push(r.grenade);
    else if (r.kind === 'drone') this.drone = r.drone;
  }

  // Interact (legacy tryInteract, index.html:3236-3241): a resupply crate in reach takes priority, otherwise a
  // breach charge is planted on the wall in front.
  private interact(events: SimEvent[]): void {
    const p = this.player;
    if (!p.alive) return;
    const crate = nearestCrate(this.crates, p.pos);
    if (crate !== null) {
      const done = resupply(
        { weapons: [this.weapon], gadgets: this.gadgets, breach: this.breach, player: p },
        crate,
      );
      if (done) events.push({ type: 'resupplied' });
      return;
    }
    plantBreach(this.breach, this.eye(), this.aimDir(), this.collision);
  }

  // The held killstreak (legacy useKillstreak, index.html:2027-2047). The slot is spent only when the effect happens:
  // a sentry with no clear ground keeps the killstreak.
  private useKillstreak(events: SimEvent[]): void {
    const p = this.player;
    if (!p.alive) return;
    const taken = takeKillstreak(this.killstreak);
    if (taken === null) return;
    const id = taken.id;
    if (id === 'uav') {
      this.uav = createUav();
    } else if (id === 'sentry') {
      const placed = placeSentry((dist) => this.groundAim(dist), this.isOpen, p.yaw);
      if (!placed.placed) {
        events.push({ type: 'sentryNoGround' });
        return;
      }
      this.turrets.push(placed.turret);
    } else {
      this.airstrikes.push(createAirstrike(this.groundAim(AIRSTRIKE_AIM_DIST)));
    }
    this.killstreak = spendKillstreak(this.killstreak);
    events.push({ type: 'killstreakUsed', id });
  }

  // Legacy groundAim (index.html:1303-1310): where the aim meets the ground, at most maxD away. A level aim uses the
  // point 8 m ahead.
  private groundAim(maxD: number): Vec2 {
    const eye = this.eye();
    const dir = this.aimDir();
    if (dir.y < GROUND_AIM_DOWN_LIMIT) {
      const t = Math.min(maxD * GROUND_AIM_REACH, -eye.y / dir.y);
      const d = Math.min(t, maxD);
      return { x: eye.x + dir.x * d, z: eye.z + dir.z * d };
    }
    return { x: eye.x + dir.x * GROUND_AIM_LEVEL_DIST, z: eye.z + dir.z * GROUND_AIM_LEVEL_DIST };
  }

  // Unit view direction (legacy aimDir, index.html:1299-1302).
  private aimDir(): Vec3 {
    const p = this.player;
    const cp = Math.cos(p.pitch);
    return { x: Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: Math.cos(p.yaw) * cp };
  }

  // Eye position (legacy eyePos, index.html:1298).
  private eye(): Vec3 {
    const p = this.player;
    return { x: p.pos.x, y: p.pos.y + p.eyeHeight, z: p.pos.z };
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
function openZoneFrom(p: Vec2, zones: readonly { x: number; z: number; captured: boolean }[]): Vec2 | null {
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

// True when the point is inside the zone radius, measured in XZ.
function within(p: Vec2, z: Zone): boolean {
  return (p.x - z.x) ** 2 + (p.z - z.z) ** 2 < z.r * z.r;
}

function at(o: Vec3, d: Vec3, t: number): Vec3 {
  return { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
