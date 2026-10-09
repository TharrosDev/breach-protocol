import type { Vec3 } from '../core/math';
import type { Enemy } from './entities';

// Recon drone. Ported from the legacy game: launchDrone (index.html:1500-1517), updDrone (1524-1534) and
// removeDrone (1518-1523). The drone has no other effect than spotting hostiles.

export interface DroneState {
  pos: Vec3;
  // Horizontal unit direction (y is always 0).
  dir: Vec3;
  // Seconds of flight left.
  t: number;
}

// index.html:1500-1517 (the drone flies at a fixed height of 5 m).
export const DRONE_HEIGHT = 5;
// index.html:1524-1534.
export const DRONE_SPEED = 9;
export const DRONE_LIFE = 10;
export const DRONE_SPOT_RANGE = 22;
export const DRONE_SPOT = 0.3;

// Starts a drone at the eye position, lifted to DRONE_HEIGHT, flying along the horizontal part of aim.
// A straight-up or straight-down aim has no horizontal part; the drone then hovers in place.
export function launchDrone(eye: Vec3, aim: Vec3): DroneState {
  const len = Math.hypot(aim.x, aim.z);
  const dir: Vec3 = len < 1e-9 ? { x: 0, y: 0, z: 0 } : { x: aim.x / len, y: 0, z: aim.z / len };
  return {
    pos: { x: eye.x, y: DRONE_HEIGHT, z: eye.z },
    dir,
    t: DRONE_LIFE,
  };
}

// Advances the drone by dt and spots living hostiles within 22 m (XZ). Mutates state and enemies.
// Returns the same state while it flies, or null once its life has run out (the caller then drops it).
export function stepDrone(state: DroneState, dt: number, enemies: Enemy[]): DroneState | null {
  state.t -= dt;
  state.pos.x += state.dir.x * DRONE_SPEED * dt;
  state.pos.z += state.dir.z * DRONE_SPEED * dt;
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = e.pos.x - state.pos.x;
    const dz = e.pos.z - state.pos.z;
    if (dx * dx + dz * dz < DRONE_SPOT_RANGE * DRONE_SPOT_RANGE) e.spot = DRONE_SPOT;
  }
  return state.t <= 0 ? null : state;
}
