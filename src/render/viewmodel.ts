// First-person weapon viewmodel: look-driven spring, reload dip, melee thrust and the scope gate.
// Formulas and constants are copied from index.html:1890-1918 (update) and 3017-3018 (look input).
// Pure module: no DOM, no randomness, no THREE.

export interface ViewmodelState {
  // Spring-followed offset (x, y) with velocity, and its target (tx, ty) fed by look input.
  x: number;
  vx: number;
  y: number;
  vy: number;
  tx: number;
  ty: number;
  // Eased reload dip, 0..1.
  rlAnim: number;
  // Recoil kick, 1 on a shot, decays to 0.
  gunKick: number;
  // Seconds left in the melee thrust, 0 when idle. The simulation owns the countdown.
  meleeT: number;
}

export interface GunPoseInput {
  adsT: number;
  moving: boolean;
  bobT: number;
  switchT: number;
  // Raw reload progress. The dip itself is driven by vm.rlAnim, which stepViewmodel eases toward
  // the reload bump, so this field is not read by gunPose.
  reloadProgress: number;
}

export interface GunPose {
  position: [number, number, number];
  rotation: [number, number, number];
  magY: number;
}

// index.html:1895-1897
const SPRING_STIFFNESS = 180;
const SPRING_DAMPING = 22;
const TARGET_DECAY = 9;
// index.html:1886
const KICK_DECAY = 9;
// index.html:1892
const RELOAD_EASE = 14;
// index.html:3017-3018
const LOOK_SCALE = 0.0009;
const LOOK_LIMIT_X = 0.09;
const LOOK_LIMIT_Y = 0.07;
// index.html:1904
const BOB_AMPLITUDE = 0.012;
// index.html:1807 (switch time) and 3246 (melee time)
const SWITCH_TIME = 0.35;
const MELEE_TIME = 0.3;
// index.html:1901
const SCOPE_ADS_THRESHOLD = 0.9;

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function createViewmodel(): ViewmodelState {
  return { x: 0, vx: 0, y: 0, vy: 0, tx: 0, ty: 0, rlAnim: 0, gunKick: 0, meleeT: 0 };
}

// index.html:3017-3018. Mouse movement pushes the spring target against the look direction.
export function applyLook(vm: ViewmodelState, movementX: number, movementY: number): void {
  vm.tx = clamp(vm.tx - movementX * LOOK_SCALE, -LOOK_LIMIT_X, LOOK_LIMIT_X);
  vm.ty = clamp(vm.ty + movementY * LOOK_SCALE, -LOOK_LIMIT_Y, LOOK_LIMIT_Y);
}

// Reload bump: dips in the first 30 % of the reload, holds through the middle, and comes back in the last 30 %.
function reloadBump(progress: number): number {
  const r = clamp(progress, 0, 1);
  if (r < 0.3) return r / 0.3;
  if (r < 0.7) return 1;
  return Math.max(0, (1 - r) / 0.3);
}

// index.html:1886-1896. Advances the viewmodel by dt seconds.
// reloadProgress is 0 when not reloading, otherwise elapsed / reload time in 0..1.
export function stepViewmodel(vm: ViewmodelState, dt: number, reloadProgress: number): void {
  vm.gunKick = Math.max(0, vm.gunKick - dt * KICK_DECAY);

  const bump = reloadBump(reloadProgress);
  vm.rlAnim += (bump - vm.rlAnim) * Math.min(1, dt * RELOAD_EASE);

  const decay = Math.exp(-dt * TARGET_DECAY);
  vm.tx *= decay;
  vm.ty *= decay;
  vm.vx += ((vm.tx - vm.x) * SPRING_STIFFNESS - vm.vx * SPRING_DAMPING) * dt;
  vm.x += vm.vx * dt;
  vm.vy += ((vm.ty - vm.y) * SPRING_STIFFNESS - vm.vy * SPRING_DAMPING) * dt;
  vm.y += vm.vy * dt;
}

// index.html:1899-1918. Pure: the same inputs always give the same pose.
export function gunPose(vm: ViewmodelState, input: GunPoseInput): GunPose {
  const { adsT, moving, bobT, switchT } = input;

  const bobAmt = (moving ? 1 : 0) * (1 - adsT * 0.8);
  const bx = Math.cos(bobT * 0.5) * BOB_AMPLITUDE * bobAmt;
  const by = Math.abs(Math.sin(bobT)) * BOB_AMPLITUDE * bobAmt;
  const sway = vm.x * (1 - adsT * 0.7);
  const mel = vm.meleeT > 0 ? Math.sin((1 - vm.meleeT / MELEE_TIME) * Math.PI) : 0;

  const x = lerp(0.24, 0, adsT) + bx + sway;
  const y =
    lerp(-0.2, -0.14, adsT) -
    vm.rlAnim * 0.25 -
    by +
    vm.y * (1 - adsT * 0.7) -
    (Math.max(0, switchT) / SWITCH_TIME) * 0.25;
  const z = lerp(-0.45, -0.34, adsT) + vm.gunKick * 0.05 - mel * 0.18;

  return {
    position: [x, y, z],
    rotation: [vm.gunKick * 0.05 + vm.rlAnim * 0.3 + mel * 0.5, 0, vm.rlAnim * 0.22],
    magY: -0.11 - vm.rlAnim * 0.32,
  };
}

// index.html:1900-1902. The DMR scope replaces the crosshair once the sight is nearly fully up.
export function isScoped(weaponId: string, adsT: number): boolean {
  return weaponId === 'dm' && adsT > SCOPE_ADS_THRESHOLD;
}
