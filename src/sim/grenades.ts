import type { Vec3 } from '../core/math';
import type { CollisionWorld } from './collision';
import type { Enemy, Operator, SmokeZone } from './entities';
import { damageEnemy } from './combat';
import { damageOperator } from './health';
import { smokeBlocks } from './ai/perception';

// Grenades, flashbangs, smoke clouds and the blast helper. Ported from the legacy game:
// throwGrenade and playerThrow (index.html:1926-1937), updGrenades (1945-1965), explodeGrenade (1966-2004),
// explodeAt (1600-1617), spawnSmoke and updSmoke (1454-1474).

export type GrenadeKind = 'frag' | 'flash' | 'smoke';
export type GrenadeOwner = 'player' | 'enemy';

export interface Grenade {
  owner: GrenadeOwner;
  kind: GrenadeKind;
  pos: Vec3;
  vel: Vec3;
  // Seconds until the grenade explodes.
  fuse: number;
}

// Smoke cloud: a sphere that blocks sight and fire (SmokeZone) with a fading draw opacity.
export interface SmokeCloud extends SmokeZone {
  // Seconds of life left. Removed by stepSmokes at zero.
  t: number;
  // Draw opacity: 0.55, fading linearly over the last 2 s of life (legacy updSmoke).
  readonly opacity: number;
}

// Result of one explosion. Enemy and operator damage is applied inside stepGrenades; the player's damage
// is returned so the caller applies it with damagePlayer, as with every other player hit.
export interface GrenadeEvent {
  kind: GrenadeKind;
  owner: GrenadeOwner;
  pos: Vec3;
  // Damage the player takes from this explosion (0 when none).
  playerDamage: number;
  // Seconds of player blindness from a flashbang (0 when none).
  playerFlashT: number;
  // Enemies and operators this explosion killed (damageEnemy and damageOperator report the kill).
  enemyKills: Enemy[];
  operatorKills: Operator[];
}

// Everything the grenade step reads or changes. Enemies and operators are mutated (damage, blind).
export interface GrenadeContext {
  world: CollisionWorld;
  enemies: Enemy[];
  operators: Operator[];
  // Smoke clouds. Explosions of smoke grenades push onto this list; stepSmokes removes expired clouds.
  smokes: SmokeCloud[];
  player: {
    // Feet position. The blast centre for the player is one metre above it (legacy P.pos.y + 1).
    pos: Vec3;
    // Eye position (legacy eyePos()).
    eye: Vec3;
    // Normalised aim direction (legacy aimDir()).
    aim: Vec3;
    alive: boolean;
  };
  difficulty: { dmg: number };
}

// Legacy constants: index.html:1926-1965 and 1966-2004.
export const GRENADE_GRAVITY = 16;
const FLOOR_Y = 0.12;
const FLOOR_BOUNCE = 0.35;
const FLOOR_FRICTION = 0.6;
const WALL_BOUNCE = 0.3;
// index.html:1933-1937 (player throw: start 0.5 m ahead of the eye, speed 14, extra 3 m/s up).
const THROW_START = 0.5;
const THROW_SPEED = 14;
const THROW_LIFT = 3;
// Fuses from playerThrow (index.html:1936).
export const FUSE: Record<GrenadeKind, number> = { frag: 2.4, smoke: 1.6, flash: 1.4 };
// index.html:1600-1617 (explodeAt for the player's frag: radius 7, 130 to enemies, 70 to the player).
export const FRAG_RADIUS = 7;
const FRAG_ENEMY_DMG = 130;
const FRAG_PLAYER_DMG = 70;
// index.html:1970-1982 (enemy frag: 80 to the player scaled by difficulty, 90 to operators).
const ENEMY_FRAG_PLAYER_DMG = 80;
const ENEMY_FRAG_OPERATOR_DMG = 90;
// index.html:1988-2003 (flashbang: 18 m, 3.5 s to hostiles, 3 s to the player when looking at it).
export const FLASH_RANGE = 18;
export const FLASH_ENEMY_T = 3.5;
export const FLASH_PLAYER_T = 3;
const FLASH_AIM_DOT = 0.2;
// index.html:1454-1474 (smoke: radius 3.6, 9 s, 0.55 opacity fading over the last 2 s, centred at y 1.2).
export const SMOKE_RADIUS = 3.6;
export const SMOKE_LIFE = 9;
const SMOKE_OPACITY = 0.55;
const SMOKE_FADE_T = 2;
const SMOKE_Y = 1.2;
// Enemy and operator body centre height for the blast test (legacy v3(x, 1, z)).
const BODY_Y = 1;
// Enemy eye height for the flash test (legacy v3(x, 1.5, z)).
const FLASH_EYE_Y = 1.5;

// Legacy throwGrenade (index.html:1926-1931). Copies the vectors so the caller keeps its own.
export function makeGrenade(
  owner: GrenadeOwner,
  kind: GrenadeKind,
  pos: Vec3,
  vel: Vec3,
  fuse: number,
): Grenade {
  return {
    owner,
    kind,
    pos: { x: pos.x, y: pos.y, z: pos.z },
    vel: { x: vel.x, y: vel.y, z: vel.z },
    fuse,
  };
}

// Legacy playerThrow (index.html:1933-1937). aim must be normalised. The caller pushes the result onto its list.
export function playerThrow(kind: GrenadeKind, eye: Vec3, aim: Vec3): Grenade {
  const pos: Vec3 = {
    x: eye.x + aim.x * THROW_START,
    y: eye.y + aim.y * THROW_START,
    z: eye.z + aim.z * THROW_START,
  };
  const vel: Vec3 = {
    x: aim.x * THROW_SPEED,
    y: aim.y * THROW_SPEED + THROW_LIFT,
    z: aim.z * THROW_SPEED,
  };
  return makeGrenade('player', kind, pos, vel, FUSE[kind]);
}

// Legacy spawnSmoke (index.html:1454-1466). The cloud is centred at (x, 1.2, z) of the burst point.
export function createSmoke(pos: Vec3): SmokeCloud {
  const cloud: SmokeCloud = {
    pos: { x: pos.x, y: SMOKE_Y, z: pos.z },
    r: SMOKE_RADIUS,
    t: SMOKE_LIFE,
    get opacity(): number {
      return SMOKE_OPACITY * Math.min(1, Math.max(0, cloud.t) / SMOKE_FADE_T);
    },
  };
  return cloud;
}

// Legacy updSmoke (index.html:1467-1474). Ages every cloud and removes the expired ones in place.
export function stepSmokes(smokes: SmokeCloud[], dt: number): void {
  for (let i = smokes.length - 1; i >= 0; i -= 1) {
    const s = smokes[i];
    if (s === undefined) continue;
    s.t -= dt;
    if (s.t <= 0) smokes.splice(i, 1);
  }
}

// Segment a-b has no box in the way. Same test as losClear in ai/perception.ts, which takes an AiWorld.
function lineClear(a: Vec3, b: Vec3, world: CollisionWorld): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  if (dist < 0.01) return true;
  const d: Vec3 = { x: (b.x - a.x) / dist, y: (b.y - a.y) / dist, z: (b.z - a.z) / dist };
  return world.raycast(a, d, dist - 0.05) === null;
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export interface BlastHit {
  enemy: Enemy;
  amount: number;
}

export interface BlastResult {
  enemies: BlastHit[];
  // Damage to the player (0 when playerPos is null, i.e. the player is dead or not in the blast).
  playerDamage: number;
}

// Blast damage with linear falloff. Pure: it returns the amounts and does not apply them.
// Living enemies within r of p (3D, to a point at y 1) with a clear line take enemyMax * (1 - d / r).
// The player (centre one metre above playerPos) with a clear line takes playerMax * (1 - d / r).
// Port of explodeAt (index.html:1600-1617).
export function blastDamage(
  p: Vec3,
  r: number,
  enemyMax: number,
  playerMax: number,
  enemies: readonly Enemy[],
  world: CollisionWorld,
  playerPos: Vec3 | null,
): BlastResult {
  const hits: BlastHit[] = [];
  for (const e of enemies) {
    if (!e.alive) continue;
    const c: Vec3 = { x: e.pos.x, y: BODY_Y, z: e.pos.z };
    const dd = dist3(p, c);
    if (dd < r && lineClear(p, c, world)) hits.push({ enemy: e, amount: enemyMax * (1 - dd / r) });
  }
  let playerDamage = 0;
  if (playerPos !== null) {
    const pc: Vec3 = { x: playerPos.x, y: playerPos.y + BODY_Y, z: playerPos.z };
    const dd = dist3(p, pc);
    if (dd < r && lineClear(p, pc, world)) playerDamage = playerMax * (1 - dd / r);
  }
  return { enemies: hits, playerDamage };
}

// Advances every grenade by dt: gravity, floor and box bounces, fuse. Grenades whose fuse runs out are
// removed from the list and explode. Returns one event per explosion, in the order they went off.
// Enemy and operator damage is applied here; the player's damage and flash time are returned.
export function stepGrenades(list: Grenade[], dt: number, ctx: GrenadeContext): GrenadeEvent[] {
  const events: GrenadeEvent[] = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const g = list[i];
    if (g === undefined) continue;
    integrate(g, dt, ctx.world);
    g.fuse -= dt;
    if (g.fuse > 0) continue;
    list.splice(i, 1);
    events.push(explode(g, ctx));
  }
  return events;
}

// Legacy updGrenades body (index.html:1946-1961), before the fuse check.
function integrate(g: Grenade, dt: number, world: CollisionWorld): void {
  g.vel.y -= GRENADE_GRAVITY * dt;
  const oldX = g.pos.x;
  const oldY = g.pos.y;
  const oldZ = g.pos.z;
  g.pos.x += g.vel.x * dt;
  g.pos.y += g.vel.y * dt;
  g.pos.z += g.vel.z * dt;
  if (g.pos.y < FLOOR_Y) {
    g.pos.y = FLOOR_Y;
    g.vel.y *= -FLOOR_BOUNCE;
    g.vel.x *= FLOOR_FRICTION;
    g.vel.z *= FLOOR_FRICTION;
  }
  // Strict inequalities and the max-y test only, as legacy. A grenade inside a box is put back where it
  // was, and its horizontal speed is reversed.
  for (const box of world.footprints()) {
    if (
      g.pos.x > box.min.x &&
      g.pos.x < box.max.x &&
      g.pos.z > box.min.z &&
      g.pos.z < box.max.z &&
      g.pos.y < box.max.y
    ) {
      g.pos.x = oldX;
      g.pos.y = oldY;
      g.pos.z = oldZ;
      g.vel.x *= -WALL_BOUNCE;
      g.vel.z *= -WALL_BOUNCE;
      break;
    }
  }
}

// Legacy explodeGrenade (index.html:1966-2004).
function explode(g: Grenade, ctx: GrenadeContext): GrenadeEvent {
  const p: Vec3 = { x: g.pos.x, y: g.pos.y, z: g.pos.z };
  const ev: GrenadeEvent = {
    kind: g.kind,
    owner: g.owner,
    pos: p,
    playerDamage: 0,
    playerFlashT: 0,
    enemyKills: [],
    operatorKills: [],
  };
  if (g.kind === 'smoke') {
    ctx.smokes.push(createSmoke(p));
  } else if (g.kind === 'frag') {
    if (g.owner === 'enemy') enemyFrag(p, ctx, ev);
    else playerFrag(p, ctx, ev);
  } else {
    flash(p, g.owner, ctx, ev);
  }
  return ev;
}

// Player frag: explodeAt(p, 7). Hurts enemies and the player inside the blast.
function playerFrag(p: Vec3, ctx: GrenadeContext, ev: GrenadeEvent): void {
  const playerPos = ctx.player.alive ? ctx.player.pos : null;
  const blast = blastDamage(
    p,
    FRAG_RADIUS,
    FRAG_ENEMY_DMG,
    FRAG_PLAYER_DMG,
    ctx.enemies,
    ctx.world,
    playerPos,
  );
  for (const hit of blast.enemies) {
    const r = damageEnemy(hit.enemy, hit.amount, false, 'player');
    if (r.killed) ev.enemyKills.push(hit.enemy);
  }
  ev.playerDamage += blast.playerDamage;
}

// Enemy frag (owner 'enemy', index.html:1970-1982). Hurts the player (scaled by difficulty) and operators.
function enemyFrag(p: Vec3, ctx: GrenadeContext, ev: GrenadeEvent): void {
  if (ctx.player.alive) {
    const pc: Vec3 = { x: ctx.player.pos.x, y: ctx.player.pos.y + BODY_Y, z: ctx.player.pos.z };
    const dd = dist3(p, pc);
    if (dd < FRAG_RADIUS && lineClear(p, pc, ctx.world)) {
      ev.playerDamage += ENEMY_FRAG_PLAYER_DMG * ctx.difficulty.dmg * (1 - dd / FRAG_RADIUS);
    }
  }
  for (const a of ctx.operators) {
    if (!a.alive) continue;
    const ac: Vec3 = { x: a.pos.x, y: BODY_Y, z: a.pos.z };
    const dd = dist3(p, ac);
    if (dd < FRAG_RADIUS && lineClear(p, ac, ctx.world)) {
      const r = damageOperator(a, ENEMY_FRAG_OPERATOR_DMG * (1 - dd / FRAG_RADIUS));
      if (r.killed) ev.operatorKills.push(a);
    }
  }
}

// Flashbang (index.html:1984-2003). A player flash blinds hostiles in view. Any flash can blind the player
// when the player is looking towards it. Smoke between the flash and the target stops the flash (spec 1.3).
function flash(p: Vec3, owner: GrenadeOwner, ctx: GrenadeContext, ev: GrenadeEvent): void {
  if (owner === 'player') {
    for (const e of ctx.enemies) {
      if (!e.alive) continue;
      const c: Vec3 = { x: e.pos.x, y: FLASH_EYE_Y, z: e.pos.z };
      if (dist3(p, c) < FLASH_RANGE && lineClear(p, c, ctx.world) && !smokeBlocks(p, c, ctx.smokes)) {
        e.blind = Math.max(e.blind, FLASH_ENEMY_T);
      }
    }
  }
  if (!ctx.player.alive) return;
  const eye = ctx.player.eye;
  const dd = dist3(p, eye);
  if (dd <= 0 || dd >= FLASH_RANGE) return;
  const to: Vec3 = { x: (p.x - eye.x) / dd, y: (p.y - eye.y) / dd, z: (p.z - eye.z) / dd };
  const facing = ctx.player.aim.x * to.x + ctx.player.aim.y * to.y + ctx.player.aim.z * to.z;
  if (facing > FLASH_AIM_DOT && lineClear(p, eye, ctx.world) && !smokeBlocks(p, eye, ctx.smokes)) {
    ev.playerFlashT = FLASH_PLAYER_T;
  }
}
