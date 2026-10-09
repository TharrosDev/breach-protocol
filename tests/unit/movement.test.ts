import { describe, it, expect } from 'vitest';
import { CollisionWorld } from '../../src/sim/collision';
import { createPlayer, stepPlayer, type PlayerState, type StepOptions } from '../../src/sim/movement';
import type { Command } from '../../src/input/commands';
import type { Action } from '../../src/content/ids';
import {
  PLAYER_R,
  WALK_SPEED,
  CROUCH_SPEED,
  SPRINT_SPEED_LIGHTWEIGHT,
  SPRINT_SPEED,
} from '../../src/content/tuning';

const DT = 1 / 60;
const NO_LW: StepOptions = { lightweight: false };
const LW: StepOptions = { lightweight: true };

interface Input {
  fwd?: -1 | 0 | 1;
  strafe?: -1 | 0 | 1;
  crouch?: boolean;
  sprint?: boolean;
  fire?: boolean;
  ads?: boolean;
  pressed?: Action[];
}

function cmd(input: Input = {}): Command {
  return {
    move: { fwd: input.fwd ?? 0, strafe: input.strafe ?? 0 },
    look: { dx: 0, dy: 0 },
    buttons: { fire: input.fire ?? false, ads: input.ads ?? false },
    pressed: new Set<Action>(input.pressed ?? []),
    crouch: input.crouch ?? false,
    sprint: input.sprint ?? false,
  };
}

function run(
  p: PlayerState,
  c: Command,
  world: CollisionWorld,
  seconds: number,
  opts: StepOptions,
  dt = DT,
): void {
  const steps = Math.round(seconds / dt);
  // Held input persists for every step. Only the one-shot pressed set is cleared after the first step.
  const held: Command = { ...c, pressed: new Set<Action>() };
  for (let i = 0; i < steps; i++) stepPlayer(p, i === 0 ? c : held, world, dt, opts);
}

function speed(p: PlayerState): number {
  return Math.hypot(p.vel.x, p.vel.z);
}

describe('walking and sprinting', () => {
  it('forward for 1 s from rest reaches 4.9 m/s within 1% (index.html:1752)', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 }, 0);
    run(p, cmd({ fwd: 1 }), new CollisionWorld(), 1, NO_LW);
    expect(WALK_SPEED).toBe(4.9);
    expect(Math.abs(speed(p) - 4.9) / 4.9).toBeLessThan(0.01);
  });

  it('crouched top speed is 2.3 m/s (index.html:1752)', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 }, 0);
    run(p, cmd({ fwd: 1, crouch: true }), new CollisionWorld(), 1, NO_LW);
    expect(CROUCH_SPEED).toBe(2.3);
    expect(Math.abs(speed(p) - 2.3) / 2.3).toBeLessThan(0.01);
    expect(p.crouch).toBe(true);
  });

  it('sprint with Lightweight reaches 8.6 m/s within 1% (index.html:1752)', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 }, 0);
    run(p, cmd({ fwd: 1, sprint: true }), new CollisionWorld(), 1, LW);
    expect(SPRINT_SPEED_LIGHTWEIGHT).toBe(8.6);
    expect(p.sprinting).toBe(true);
    expect(Math.abs(speed(p) - 8.6) / 8.6).toBeLessThan(0.01);
  });

  it('sprint without Lightweight reaches 7.4 m/s within 1%', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 }, 0);
    run(p, cmd({ fwd: 1, sprint: true }), new CollisionWorld(), 1, NO_LW);
    expect(SPRINT_SPEED).toBe(7.4);
    expect(Math.abs(speed(p) - 7.4) / 7.4).toBeLessThan(0.01);
  });

  it('sprint needs forward input: sideways sprint stays at walk speed', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 }, 0);
    run(p, cmd({ strafe: 1, sprint: true }), new CollisionWorld(), 1, LW);
    expect(p.sprinting).toBe(false);
    expect(Math.abs(speed(p) - WALK_SPEED) / WALK_SPEED).toBeLessThan(0.01);
  });
});

describe('jumping', () => {
  it('jump from rest reaches the continuous apex 7.2^2 / (2 * 22) = 1.1782 m within 1% at a fine step', () => {
    // Legacy integration is semi-implicit Euler, so the discrete apex falls short by about v0 * dt / 2.
    // At 1/1000 s the error is about 3.6 mm (0.3%). At 60 Hz the apex is 1.119 m (-5%).
    const fine = 1 / 1000;
    const p = createPlayer({ x: 0, y: 0, z: 0 }, 0);
    const w = new CollisionWorld();
    stepPlayer(p, cmd({ pressed: ['jump'] }), w, fine, NO_LW);
    let apex = p.pos.y;
    for (let i = 0; i < 2000 && !p.onGround; i++) {
      stepPlayer(p, cmd(), w, fine, NO_LW);
      apex = Math.max(apex, p.pos.y);
    }
    const expected = (7.2 * 7.2) / (2 * 22);
    expect(expected).toBeCloseTo(1.1782, 4);
    expect(Math.abs(apex - expected) / expected).toBeLessThan(0.01);
  });
});

describe('slide', () => {
  it('needs speed of at least 4 m/s to start', () => {
    const w = new CollisionWorld();

    const slow = createPlayer({ x: 0, y: 0, z: 0 }, 0);
    slow.sprinting = true;
    slow.vel.z = 3;
    stepPlayer(slow, cmd({ crouch: true, pressed: ['crouch'] }), w, DT, NO_LW);
    expect(slow.sliding).toBe(0);

    const fast = createPlayer({ x: 0, y: 0, z: 0 }, 0);
    fast.sprinting = true;
    fast.vel.z = 5;
    stepPlayer(fast, cmd({ crouch: true, pressed: ['crouch'] }), w, DT, NO_LW);
    expect(fast.sliding).toBeGreaterThan(0.8);
    expect(fast.slideSpeed).toBe(8.5);
    expect(fast.slideDir.z).toBeCloseTo(1, 9);
  });
});

describe('vault', () => {
  it('vaults a 1.0 m box placed 0.5 m ahead and lands past it within 3 m', () => {
    const w = new CollisionWorld();
    // Box spans z 0.5 to 1.5, top at 1.0 m. The player stands at the origin facing +z.
    w.add({ min: { x: -1, y: 0, z: 0.5 }, max: { x: 1, y: 1.0, z: 1.5 } });
    const p = createPlayer({ x: 0, y: 0, z: 0 }, 0);

    stepPlayer(p, cmd({ pressed: ['jump'] }), w, DT, NO_LW);
    expect(p.vault).not.toBeNull();
    expect(p.vault?.to.z ?? 0).toBeGreaterThan(1.5);

    run(p, cmd(), w, 0.5, NO_LW);
    expect(p.vault).toBeNull();
    expect(p.pos.z).toBeGreaterThan(1.5);
    expect(p.pos.z).toBeLessThanOrEqual(3);
  });

  it('does not vault a box whose top is above 1.35 m', () => {
    const w = new CollisionWorld();
    w.add({ min: { x: -1, y: 0, z: 0.5 }, max: { x: 1, y: 1.6, z: 1.5 } });
    const p = createPlayer({ x: 0, y: 0, z: 0 }, 0);
    stepPlayer(p, cmd({ pressed: ['jump'] }), w, DT, NO_LW);
    expect(p.vault).toBeNull();
    expect(p.vy).toBeGreaterThan(0);
  });
});

describe('collision', () => {
  it('a wall stops the player at radius PLAYER_R (0.35 m)', () => {
    const w = new CollisionWorld();
    w.add({ min: { x: -5, y: 0, z: 3 }, max: { x: 5, y: 4.2, z: 4 } });
    const p = createPlayer({ x: 0, y: 0, z: 0 }, 0);
    run(p, cmd({ fwd: 1 }), w, 3, NO_LW);
    expect(PLAYER_R).toBe(0.35);
    expect(3 - p.pos.z).toBeCloseTo(PLAYER_R, 6);
  });
});
