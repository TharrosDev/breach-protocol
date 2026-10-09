// Box-built humanoid models for enemies and operators. Geometry and materials follow
// index.html:1198-1247 (TEMPLATES, makeMesh), animation follows 2171-2180 (animateHuman),
// and the per-frame placement and death pose follow 2244-2251 and 2328-2357 (updEnemy)
// and 2445-2451 (updAlly). No DOM is touched here: the caller adds the group to the scene.
import * as THREE from 'three';
import { ENEMY_DEFS, type EnemyKindId } from '../content/enemies';

const TAU = Math.PI * 2;
const MARK_COLOUR = 0xff3b3b;

export interface HumanRig {
  group: THREE.Group;
  // Leg pivots: [left, right].
  legs: THREE.Object3D[];
  // Arm pivots: [left, right].
  arms: THREE.Object3D[];
  // Red octahedron above the head, shown while the enemy has spotted the player.
  marker: THREE.Object3D;
  // Rifle or sniper rifle held by the right arm.
  gun: THREE.Object3D;
  // Local z of the gun at rest, the recoil offset is taken from this.
  baseGunZ: number;
}

export interface HumanAnimState {
  phase: number;
  moving: boolean;
  aiming: boolean;
}

// Render-side view of one body. fall, kick and crouch are render-only and are updated in place.
// flinchT and hiding come from the sim (the flinch timer and cover state).
export interface HumanPlaceState {
  x: number;
  z: number;
  yaw: number;
  // Gun recoil. Decays at dt * 8 and is written back to the state.
  kick: number;
  // Cover crouch, lerped toward hiding ? 1 : 0 and written back to the state.
  crouch: number;
  hiding: boolean;
  // Remaining time of the hit flinch (sim-owned, read only). Pushes the body back by flinchT * 2.5.
  flinchT: number;
  // Spotted timer. The marker is shown while it is above zero.
  spot: number;
  phase: number;
  moving: boolean;
  alive: boolean;
  // Death fall progress, 0 to 1. Advanced in place while the body is dead.
  fall: number;
  tumble: -1 | 1;
  time: number;
  dt: number;
}

interface TemplateParts {
  cloth: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  vestMat: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  torso: THREE.BufferGeometry;
  vest: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  helmet: THREE.BufferGeometry;
  visor: THREE.BufferGeometry;
  pack: THREE.BufferGeometry;
  gun: THREE.BufferGeometry;
  shield: THREE.BufferGeometry;
}

interface KindFlags {
  heavy: boolean;
  sniper: boolean;
  grenadier: boolean;
}

// Operators reuse the rifleman's silhouette.
function flagsFor(kind: EnemyKindId | 'operator'): KindFlags {
  if (kind === 'operator') return { heavy: false, sniper: false, grenadier: false };
  const def = ENEMY_DEFS[kind];
  return { heavy: def.heavy, sniper: def.sniper, grenadier: def.grenadier };
}

const templates = new Map<string, TemplateParts>();
let markGeometry: THREE.BufferGeometry | null = null;
let markMaterial: THREE.MeshBasicMaterial | null = null;

// index.html:1198-1221. Geometry and materials are shared per kind and colour.
function template(kind: EnemyKindId | 'operator', colour: number): TemplateParts {
  const key = `${kind}:${String(colour)}`;
  const cached = templates.get(key);
  if (cached) return cached;
  const flags = flagsFor(kind);
  const tw = flags.heavy ? 0.8 : 0.52;
  const parts: TemplateParts = {
    cloth: new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.7 }),
    vestMat: new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.95 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xc9a77f, roughness: 0.8 }),
    torso: new THREE.BoxGeometry(tw, 0.75, 0.42),
    vest: new THREE.BoxGeometry(tw + 0.08, 0.5, 0.48),
    arm: new THREE.BoxGeometry(0.16, 0.66, 0.18),
    leg: new THREE.BoxGeometry(0.22, 0.8, 0.25),
    head: new THREE.SphereGeometry(0.19, 12, 10),
    helmet: new THREE.SphereGeometry(0.22, 12, 8, 0, TAU, 0, Math.PI / 2),
    visor: new THREE.BoxGeometry(0.28, 0.06, 0.05),
    pack: new THREE.BoxGeometry(0.42, 0.5, 0.22),
    gun: flags.sniper ? new THREE.BoxGeometry(0.1, 0.12, 1.1) : new THREE.BoxGeometry(0.11, 0.12, 0.75),
    shield: new THREE.BoxGeometry(0.9, 1.3, 0.07),
  };
  templates.set(key, parts);
  return parts;
}

function markerParts(): { geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial } {
  if (!markGeometry) markGeometry = new THREE.OctahedronGeometry(0.14);
  if (!markMaterial) markMaterial = new THREE.MeshBasicMaterial({ color: MARK_COLOUR });
  return { geometry: markGeometry, material: markMaterial };
}

// index.html:1222-1247. Builds one body. kind 'operator' uses the rifleman template with the given colour.
export function makeHumanRig(kind: EnemyKindId | 'operator', colour: number): HumanRig {
  const t = template(kind, colour);
  const flags = flagsFor(kind);
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';

  const torso = new THREE.Mesh(t.torso, t.cloth);
  torso.position.y = 1.12;
  const vest = new THREE.Mesh(t.vest, t.vestMat);
  vest.position.set(0, 1.14, 0.02);
  const head = new THREE.Mesh(t.head, t.skin);
  head.position.y = 1.6;
  const helmet = new THREE.Mesh(t.helmet, t.dark);
  helmet.position.y = 1.62;
  const visor = new THREE.Mesh(t.visor, t.dark);
  visor.position.set(0, 1.6, 0.17);
  const gun = new THREE.Mesh(t.gun, t.dark);
  const baseGunZ = flags.sniper ? 0.5 : 0.4;
  gun.position.set(0.22, 1.15, baseGunZ);
  group.add(torso, vest, head, helmet, visor, gun);

  const arms = [-0.34, 0.34].map((x) => {
    const arm = new THREE.Mesh(t.arm, t.cloth);
    arm.position.set(x, 1.12, 0);
    group.add(arm);
    return arm;
  });
  const legs = [-0.14, 0.14].map((x) => {
    const leg = new THREE.Mesh(t.leg, t.dark);
    leg.position.set(x, 0.4, 0);
    group.add(leg);
    return leg;
  });

  if (flags.grenadier) {
    const pack = new THREE.Mesh(t.pack, t.dark);
    pack.position.set(0, 1.15, -0.32);
    group.add(pack);
  }
  if (flags.heavy) {
    const shield = new THREE.Mesh(t.shield, t.dark);
    shield.position.set(0, 1.0, 0.42);
    group.add(shield);
  }

  const mark = markerParts();
  const marker = new THREE.Mesh(mark.geometry, mark.material);
  marker.position.y = 2.25;
  marker.visible = false;
  group.add(marker);

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  marker.castShadow = false;

  return { group, legs, arms, marker, gun, baseGunZ };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// index.html:2171-2180. Swings the legs while moving, raises the arms when aiming.
// Returns the new gait phase; the caller stores it.
export function animateHuman(rig: HumanRig, state: HumanAnimState, dt: number): number {
  const phase = state.phase + dt * (state.moving ? 9 : 0);
  const swing = Math.sin(phase) * (state.moving ? 0.6 : 0);
  const legL = rig.legs[0];
  const legR = rig.legs[1];
  const armL = rig.arms[0];
  const armR = rig.arms[1];
  if (legL) legL.rotation.x = swing;
  if (legR) legR.rotation.x = -swing;
  const armTargetR = state.aiming ? -1.45 : -swing * 0.5;
  const armTargetL = state.aiming ? -1.25 : swing * 0.5;
  const blend = Math.min(1, dt * 10);
  if (armR) armR.rotation.x = lerp(armR.rotation.x, armTargetR, blend);
  if (armL) armL.rotation.x = lerp(armL.rotation.x, armTargetL, blend);
  return phase;
}

// index.html:2244-2251 (dead fall), 2328-2357 (group transform, crouch, bob, gun recoil).
// Writes group transform, scale, marker, gun recoil and death pose. Updates state.fall, state.kick and
// state.crouch in place. A dead body only falls: its group position is left where it last stood.
export function placeHumanEnemy(rig: HumanRig, state: HumanPlaceState): void {
  const { group, marker, gun } = rig;

  if (!state.alive) {
    state.fall = Math.min(1, state.fall + state.dt * 3);
    group.rotation.x = (-Math.PI / 2) * state.fall;
    group.position.y = 0.3 * state.fall;
    group.rotation.z = state.tumble * 0.5 * state.fall;
    marker.visible = false;
    return;
  }

  // Upright pose. Only a dead body is ever tilted, so this resets a revived operator.
  group.rotation.x = 0;
  group.rotation.z = 0;

  const kick = Math.max(0, state.flinchT) * 2.5;
  group.position.x = state.x - Math.sin(state.yaw) * kick;
  group.position.z = state.z - Math.cos(state.yaw) * kick;

  // Cover: drop into a crouch. Walking: a small bob.
  state.crouch += ((state.hiding ? 1 : 0) - state.crouch) * Math.min(1, state.dt * 7);
  group.scale.y = 1 - 0.28 * state.crouch;
  group.position.y = Math.abs(Math.sin(state.phase)) * 0.05 * (state.moving ? 1 : 0);

  marker.visible = state.spot > 0;
  marker.rotation.y = state.time * 3;

  state.kick = Math.max(0, state.kick - state.dt * 8);
  gun.position.z = rig.baseGunZ - state.kick * 0.12;

  group.rotation.y = state.yaw;
}
