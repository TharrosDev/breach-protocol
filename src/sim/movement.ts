import type { Vec2, Vec3 } from '../core/math';
import {
  COYOTE_TIME,
  CROUCH_SPEED,
  GRAVITY,
  JUMP_BUFFER,
  JUMP_VELOCITY,
  PLAYER_R,
  SLIDE_MIN_EXIT_SPEED,
  SLIDE_MIN_SPEED,
  SLIDE_TIME,
  SPRINT_COOLDOWN,
  SPRINT_SPEED,
  SPRINT_SPEED_LIGHTWEIGHT,
  STAMINA_DRAIN,
  STAMINA_REGEN,
  VAULT_TIME,
  WALK_SPEED,
} from '../content/tuning';
import type { Command } from '../input/commands';
import type { CollisionWorld } from './collision';

export interface VaultState {
  t: number;
  from: Vec2;
  to: Vec2;
}

// Spec fields plus four legacy fields the port needs: adsT (P.adsT), sprinting, wasSprinting and moving.
export interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  onGround: boolean;
  crouch: boolean;
  // Seconds of slide left (legacy P.slideT). Positive while sliding.
  sliding: number;
  slideDir: Vec2;
  slideSpeed: number;
  stamina: number;
  hp: number;
  alive: boolean;
  vy: number;
  jumpBuffer: number;
  coyote: number;
  sprintCool: number;
  vault: VaultState | null;
  eyeHeight: number;
  adsT: number;
  sprinting: boolean;
  wasSprinting: boolean;
  moving: boolean;
}

export interface StepOptions {
  lightweight: boolean;
  // ADS blend rate per second. Legacy index.html:1728 uses 17 with Reflex and 12 otherwise.
  // Defaults to 17, the Reflex value that the default loadout uses.
  adsRate?: number;
  // Multiplier on ground speed (stim shot). Defaults to 1.
  speedMul?: number;
}

// index.html:1754. Ground control 10 and air control 3.5 are blend rates per second.
const GROUND_CONTROL = 10;
const AIR_CONTROL = 3.5;
// index.html:1753. ADS slows movement by up to 40 percent.
const ADS_SLOW = 0.4;
const ADS_RATE_DEFAULT = 17;
// index.html:1738. Sprint needs ADS blend below 0.05, stamina above 0.02, and fire not held.
const SPRINT_MAX_ADS = 0.05;
const SPRINT_MIN_STAMINA = 0.02;
// index.html:1744. Lightweight drains stamina at 0.6 times the normal rate.
const LIGHTWEIGHT_DRAIN = 0.6;
// index.html:1772-1773. Eye heights while sliding, crouched and standing. Lerp rate 12 per second.
const EYE_SLIDE = 0.6;
const EYE_CROUCH = 0.95;
const EYE_STAND = 1.65;
const EYE_RATE = 12;
// index.html:1760. Playable bounds on x and z.
const WORLD_LIMIT = 57;
// index.html:1698-1710 (tryVault). The probe runs at 0.6 m, reaches 1.1 m, and needs the box top in [0.5, 1.35].
const VAULT_PROBE_Y = 0.6;
const VAULT_REACH = 1.1;
const VAULT_MIN_TOP = 0.5;
const VAULT_MAX_TOP = 1.35;
// index.html:1703-1706. Landing scan from 0.3 m to 3.0 m past the box in 0.2 m steps, with 0.4 m clearance.
const VAULT_LAND_START = 0.3;
const VAULT_LAND_END = 3.0;
const VAULT_LAND_STEP = 0.2;
const VAULT_LAND_CLEAR = 0.4;
// Probe for the top face of a box: a downward ray from above every box in the world.
const TOP_PROBE_Y = 100;
const TOP_PROBE_MAX_T = 200;

export function createPlayer(spawn: Vec3, yaw: number): PlayerState {
  return {
    pos: { x: spawn.x, y: spawn.y, z: spawn.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    onGround: true,
    crouch: false,
    sliding: 0,
    slideDir: { x: 0, z: 0 },
    slideSpeed: 0,
    stamina: 1,
    hp: 100,
    alive: true,
    vy: 0,
    jumpBuffer: 0,
    coyote: 0,
    sprintCool: 0,
    vault: null,
    eyeHeight: EYE_STAND,
    adsT: 0,
    sprinting: false,
    wasSprinting: false,
    moving: false,
  };
}

// index.html:1691-1697. Needs speed of at least 4 m/s. The slide keeps at least 8.5 m/s, and its direction is frozen.
function startSlide(p: PlayerState): void {
  const sp = Math.hypot(p.vel.x, p.vel.z);
  if (sp < SLIDE_MIN_SPEED) return;
  p.sliding = SLIDE_TIME;
  p.slideSpeed = Math.max(sp, SLIDE_MIN_EXIT_SPEED);
  p.slideDir = { x: p.vel.x / sp, z: p.vel.z / sp };
}

// The legacy vault reads the hit box's breakable flag and max.y directly (index.html:1701).
// CollisionWorld exposes no box lookup, so both facts come from raycasts: a breakable-only ray
// that hits the same box, and a downward ray through the entry point that reports the top face.
// For the ground-based boxes used here this matches the legacy checks exactly.
function isBreakableHit(world: CollisionWorld, o: Vec3, d: Vec3, id: number): boolean {
  const breakable = world.raycast(o, d, VAULT_REACH, { onlyBreakable: true });
  return breakable !== null && breakable.id === id;
}

function boxTopAt(world: CollisionWorld, o: Vec3, d: Vec3, t: number, id: number): number | null {
  // A point just inside the entry face is inside the box footprint, so the downward ray hits its top.
  const inside = t + 1e-3;
  const down = world.raycast(
    { x: o.x + d.x * inside, y: TOP_PROBE_Y, z: o.z + d.z * inside },
    { x: 0, y: -1, z: 0 },
    TOP_PROBE_MAX_T,
  );
  if (down === null || down.id !== id) return null;
  return TOP_PROBE_Y - down.t;
}

// index.html:1698-1710.
function tryVault(p: PlayerState, world: CollisionWorld, sy: number, cy: number): boolean {
  const o: Vec3 = { x: p.pos.x, y: VAULT_PROBE_Y, z: p.pos.z };
  const d: Vec3 = { x: sy, y: 0, z: cy };
  const hit = world.raycast(o, d, VAULT_REACH);
  if (hit === null) return false;
  if (isBreakableHit(world, o, d, hit.id)) return false;
  const top = boxTopAt(world, o, d, hit.t, hit.id);
  if (top === null || top > VAULT_MAX_TOP || top < VAULT_MIN_TOP) return false;

  // Land on the first free spot past the obstacle (its far face may be a few metres deep).
  let to: Vec2 | null = null;
  for (let k = VAULT_LAND_START; k <= VAULT_LAND_END; k += VAULT_LAND_STEP) {
    const x = p.pos.x + sy * (hit.t + k);
    const z = p.pos.z + cy * (hit.t + k);
    if (world.pointFree(x, z, VAULT_LAND_CLEAR)) {
      to = { x, z };
      break;
    }
  }
  if (to === null) return false;
  p.vault = { t: 0, from: { x: p.pos.x, z: p.pos.z }, to };
  return true;
}

// index.html:1712-1720. The vault overrides movement and gravity until it finishes.
function updVault(p: PlayerState, v: VaultState, dt: number): void {
  v.t += dt;
  const a = Math.min(1, v.t / VAULT_TIME);
  p.pos.x = v.from.x + (v.to.x - v.from.x) * a;
  p.pos.z = v.from.z + (v.to.z - v.from.z) * a;
  p.vel.x = 0;
  p.vel.y = 0;
  p.vel.z = 0;
  if (a >= 1) p.vault = null;
}

// Advances one fixed step. Port of legacy updPlayer (index.html:1721-1773), with the keydown
// effects of legacy index.html:2986-2987 applied first, from the command's pressed set.
// Choices where the legacy is ambiguous or depends on the frame loop are noted inline.
export function stepPlayer(
  p: PlayerState,
  cmd: Command,
  world: CollisionWorld,
  dt: number,
  opts: StepOptions,
): void {
  const lw = opts.lightweight;
  const adsRate = opts.adsRate ?? ADS_RATE_DEFAULT;

  // Legacy runs these on keydown, before updPlayer. The command carries the presses of this step.
  if (cmd.pressed.has('crouch') && p.sprinting && p.onGround && p.alive) startSlide(p);
  if (cmd.pressed.has('jump')) p.jumpBuffer = JUMP_BUFFER;

  if (p.vault !== null) {
    updVault(p, p.vault, dt);
    return;
  }

  // Legacy P.downed branch (index.html:1722) is out of phase 1 scope: there is no downed state yet.
  const fwd = cmd.move.fwd;
  const str = cmd.move.strafe;
  p.crouch = cmd.crouch;
  const ads = cmd.buttons.ads && p.alive ? 1 : 0;
  p.adsT += (ads - p.adsT) * Math.min(1, dt * adsRate);
  p.moving = fwd !== 0 || str !== 0;

  // Yaw 0 faces +z, as legacy index.html:1732-1735.
  const sy = Math.sin(p.yaw);
  const cy = Math.cos(p.yaw);
  let mx = sy * fwd - cy * str;
  let mz = cy * fwd + sy * str;
  const len = Math.hypot(mx, mz);
  if (len > 0) {
    mx /= len;
    mz /= len;
  }

  // Legacy !fireHeld (index.html:1738) maps to cmd.buttons.fire.
  const wantSprint =
    cmd.sprint &&
    fwd > 0 &&
    !p.crouch &&
    p.adsT < SPRINT_MAX_ADS &&
    !cmd.buttons.fire &&
    p.stamina > SPRINT_MIN_STAMINA &&
    p.onGround;
  p.sprinting = wantSprint && p.sliding <= 0;
  // A short cooldown after sprinting, so you can't snap-fire the instant you stop.
  if (p.wasSprinting && !p.sprinting) p.sprintCool = SPRINT_COOLDOWN;
  p.wasSprinting = p.sprinting;
  p.sprintCool = Math.max(0, p.sprintCool - dt);
  p.stamina = Math.min(
    1,
    Math.max(
      0,
      p.stamina + (p.sprinting ? -dt * STAMINA_DRAIN * (lw ? LIGHTWEIGHT_DRAIN : 1) : dt * STAMINA_REGEN),
    ),
  );

  const alive = p.alive ? 1 : 0;
  if (p.sliding > 0) {
    p.sliding -= dt;
    const k = Math.max(0, p.sliding / SLIDE_TIME) * p.slideSpeed;
    p.vel.x = p.slideDir.x * k;
    p.vel.z = p.slideDir.z * k;
  } else {
    let speed = p.crouch
      ? CROUCH_SPEED
      : p.sprinting
        ? lw
          ? SPRINT_SPEED_LIGHTWEIGHT
          : SPRINT_SPEED
        : WALK_SPEED;
    speed *= (1 - p.adsT * ADS_SLOW) * (opts.speedMul ?? 1);
    const ac = p.onGround ? GROUND_CONTROL : AIR_CONTROL;
    p.vel.x += (mx * speed * alive - p.vel.x) * Math.min(1, dt * ac);
    p.vel.z += (mz * speed * alive - p.vel.z) * Math.min(1, dt * ac);
  }
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  // index.html:1759. CollisionWorld.pushOut runs the two passes of legacy moveCollide.
  world.pushOut(p.pos, PLAYER_R);
  p.pos.x = Math.min(WORLD_LIMIT, Math.max(-WORLD_LIMIT, p.pos.x));
  p.pos.z = Math.min(WORLD_LIMIT, Math.max(-WORLD_LIMIT, p.pos.z));

  // Jump buffer and coyote time: a jump pressed just before landing, or just after leaving a ledge, still counts.
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
  p.coyote = p.onGround ? COYOTE_TIME : Math.max(0, p.coyote - dt);
  if (p.jumpBuffer > 0 && p.alive && p.sliding <= 0 && (p.onGround || p.coyote > 0)) {
    if (!(p.onGround && tryVault(p, world, sy, cy))) {
      p.vy = JUMP_VELOCITY;
      p.onGround = false;
      p.coyote = 0;
    }
    p.jumpBuffer = 0;
  }
  // Semi-implicit Euler, as legacy: velocity first, then position. At 60 Hz the apex is about 1.12 m, not 1.178 m.
  p.vy -= GRAVITY * dt;
  p.pos.y += p.vy * dt;
  if (p.pos.y <= 0) {
    p.pos.y = 0;
    p.vy = 0;
    p.onGround = true;
  }
  const eyeTarget = p.sliding > 0 ? EYE_SLIDE : p.crouch ? EYE_CROUCH : EYE_STAND;
  p.eyeHeight += (eyeTarget - p.eyeHeight) * Math.min(1, dt * EYE_RATE);
}
