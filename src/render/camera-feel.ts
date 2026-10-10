// Camera feel: a sprint FOV kick, a footstep head bob and a trauma-style shake. Pure, so it can be tested.
// The shake follows trauma^2 so a small hit is subtle and a big one is violent, and it is scaled by the
// player's shake setting at the call site (pass scale 0 to turn it off).

export interface CameraFeelState {
  // Eased sprint blend 0..1.
  sprint: number;
  // Trauma 0..1. Decays over time.
  trauma: number;
  // Eased landing dip in metres.
  dip: number;
  clock: number;
}

export function createCameraFeel(): CameraFeelState {
  return { sprint: 0, trauma: 0, dip: 0, clock: 0 };
}

export function addTrauma(state: CameraFeelState, amount: number): void {
  state.trauma = Math.min(1, state.trauma + amount);
}

export interface CameraOffsets {
  // Field of view added on top of the base FOV, in degrees.
  fovDelta: number;
  // Position offsets in camera space, metres.
  x: number;
  y: number;
  // Roll and pitch offsets in radians.
  roll: number;
  pitch: number;
}

const TRAUMA_DECAY = 1.6;
const FOV_SPRINT = 5;

// noise-free pseudo shake from a few sines at incommensurate rates
function wobble(t: number, seed: number): number {
  return (
    Math.sin(t * 31.7 + seed) * 0.5 +
    Math.sin(t * 47.3 + seed * 2.1) * 0.3 +
    Math.sin(t * 71.9 + seed * 0.7) * 0.2
  );
}

export function stepCameraFeel(
  state: CameraFeelState,
  dt: number,
  input: { sprinting: boolean; moving: boolean; bobT: number; ads: number; shakeScale: number },
): CameraOffsets {
  state.clock += dt;
  state.trauma = Math.max(0, state.trauma - dt * TRAUMA_DECAY);
  const target = input.sprinting ? 1 : 0;
  state.sprint += (target - state.sprint) * Math.min(1, dt * 6);
  const s = state.sprint * (1 - input.ads);
  const shake = state.trauma * state.trauma * input.shakeScale;
  const bob = input.moving ? 1 : 0;
  return {
    fovDelta: s * FOV_SPRINT,
    x: wobble(state.clock, 1) * 0.05 * shake + Math.cos(input.bobT * 0.5) * 0.006 * bob * s,
    y: wobble(state.clock, 5) * 0.05 * shake + Math.abs(Math.sin(input.bobT)) * 0.012 * bob * s,
    roll: wobble(state.clock, 9) * 0.05 * shake + Math.sin(input.bobT * 0.5) * 0.004 * bob * s,
    pitch: wobble(state.clock, 13) * 0.03 * shake,
  };
}
