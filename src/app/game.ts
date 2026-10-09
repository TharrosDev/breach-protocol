import * as THREE from 'three';
import { FixedStep } from '../core/clock';
import type { Vec3 } from '../core/math';
import { COMPOUND } from '../content/maps/compound';
import { WEAPONS } from '../content/weapons';
import { YAW_PER_PX } from '../content/tuning';
import { Bindings } from '../input/bindings';
import { buildCommand } from '../input/commands';
import { KeyboardInput } from '../input/keyboard';
import { MouseInput } from '../input/mouse';
import { PointerLock } from '../input/pointer-lock';
import { loadBindings, loadLoadout, loadSettings } from '../persist/store';
import { boxMesh, buildBoxes } from '../render/boxes';
import { createRenderer } from '../render/renderer';
import { CollisionWorld, type BoxId } from '../sim/collision';
import { createPlayer, stepPlayer, type PlayerState } from '../sim/movement';
import { makeWeaponState, tickWeapon, tryFire, type WeaponState } from '../sim/weapons';
import { installDebugHook, type GameState } from './debug-hook';

export interface GameHandle {
  state(): GameState;
  dispose(): void;
}

// Team spawn from legacy index.html:1090. The yaw faces the compound; legacy spawn yaw is not part of this task.
const SPAWN: Vec3 = { x: 0, y: 0, z: 46 };
const SPAWN_YAW = Math.PI;
// Pitch clamp from legacy index.html:3015.
const PITCH_LIMIT = 1.45;
// Dummy targets: 0.8 m wide, 1.8 m tall, on open ground south of the compound.
const TARGET_SPOTS: readonly { x: number; z: number }[] = [
  { x: -12, z: 36 },
  { x: 0, z: 34 },
  { x: 12, z: 36 },
];
const TARGET_HALF = 0.4;
const TARGET_H = 1.8;
const SHOT_RANGE = 500;
// index.html:1728. Reflex blends ADS at 17 per second; the loadout is fixed to VX with Reflex in phase 1.
const ADS_RATE_REFLEX = 17;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Starts the match loop inside root. Returns a handle for tests and teardown.
export function startGame(root: HTMLElement, opts: { debug: boolean }): GameHandle {
  const settings = loadSettings();
  const bindings = new Bindings(loadBindings());
  const loadout = loadLoadout();
  const lightweight = loadout.perk === 'lightweight';

  root.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.className = 'play-canvas';
  const overlay = document.createElement('button');
  overlay.type = 'button';
  overlay.className = 'pause-overlay';
  overlay.textContent = 'Click to resume';
  overlay.hidden = true;
  root.append(canvas, overlay);

  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 400);

  const world = new CollisionWorld();
  buildBoxes(scene, COMPOUND, world);

  const targetMat = new THREE.MeshStandardMaterial({ color: 0xd9783a, roughness: 0.6 });
  const targetIds = new Set<BoxId>();
  for (const spot of TARGET_SPOTS) {
    const box = {
      min: { x: spot.x - TARGET_HALF, y: 0, z: spot.z - TARGET_HALF },
      max: { x: spot.x + TARGET_HALF, y: TARGET_H, z: spot.z + TARGET_HALF },
    };
    targetIds.add(world.add(box));
    scene.add(boxMesh({ ...box, breakable: false }, targetMat));
  }

  const P: PlayerState = createPlayer(SPAWN, SPAWN_YAW);
  const weapon: WeaponState = makeWeaponState(WEAPONS.vx, 'reflex');
  const step = new FixedStep(60);

  let state: GameState = 'play';
  let shots = 0;
  let hits = 0;
  // Presses and fire clicks are latched until a sim step consumes them. A frame can run zero steps.
  let pendingPressed = new Set<string>();
  let fireClick = false;
  let prevX = P.pos.x;
  let prevY = P.pos.y;
  let prevZ = P.pos.z;
  let last: number | null = null;
  let raf = 0;
  let disposed = false;

  const keyboard = new KeyboardInput(() => state === 'play');
  keyboard.attach(window);
  const mouse = new MouseInput(() => state === 'play');
  mouse.attach(canvas, window);
  const lock = new PointerLock(canvas, document);
  lock.attach();
  let wasLocked = false;

  const pause = (): void => {
    if (state !== 'play') return;
    state = 'paused';
    keyboard.clear();
    mouse.clear();
    fireClick = false;
    overlay.hidden = false;
  };

  const resume = (): void => {
    if (state === 'play') return;
    state = 'play';
    overlay.hidden = true;
    last = null;
  };

  const unsubscribeLock = lock.onChange((locked) => {
    if (locked) {
      wasLocked = true;
      resume();
      return;
    }
    // Losing a lock we held pauses the match. A browser that never granted a lock keeps playing.
    if (wasLocked) pause();
  });

  const onOverlayClick = (): void => {
    void lock.request();
    resume();
  };
  overlay.addEventListener('click', onOverlayClick);

  const onCanvasMouseDown = (event: MouseEvent): void => {
    if (state === 'play' && event.button === 0) fireClick = true;
  };
  canvas.addEventListener('mousedown', onCanvasMouseDown);

  const onVisibility = (): void => {
    if (document.hidden) {
      keyboard.clear();
      mouse.clear();
      fireClick = false;
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onResize = (): void => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);
  onResize();

  // Legacy mousemove handler (index.html:3012-3016). Applied once per frame, not per fixed step.
  const applyLook = (dx: number, dy: number): void => {
    const s = YAW_PER_PX * settings.sens * lerp(1, settings.adsMul, P.adsT);
    P.yaw -= dx * s;
    P.pitch = clamp(P.pitch + (settings.invertY ? 1 : -1) * dy * s, -PITCH_LIMIT, PITCH_LIMIT);
  };

  // Ray from the eye along the view direction. A hit on a dummy target counts once.
  const fireShot = (): void => {
    const origin: Vec3 = { x: P.pos.x, y: P.pos.y + P.eyeHeight, z: P.pos.z };
    const cp = Math.cos(P.pitch);
    const dir: Vec3 = { x: Math.sin(P.yaw) * cp, y: Math.sin(P.pitch), z: Math.cos(P.yaw) * cp };
    shots += 1;
    const hit = world.raycast(origin, dir, SHOT_RANGE);
    if (hit !== null && targetIds.has(hit.id)) hits += 1;
  };

  const simStep = (first: boolean): void => {
    const pressed: ReadonlySet<string> = first ? pendingPressed : new Set<string>();
    if (first) pendingPressed = new Set<string>();
    const buttons = mouse.buttons();
    const cmd = buildCommand(keyboard.held(), buttons, { dx: 0, dy: 0 }, pressed, bindings);

    prevX = P.pos.x;
    prevY = P.pos.y;
    prevZ = P.pos.z;
    stepPlayer(P, cmd, world, step.dt, { lightweight, adsRate: ADS_RATE_REFLEX });

    tickWeapon(weapon, step.dt, cmd.buttons.fire, loadout.perk);
    const requested = fireClick;
    fireClick = false;
    // Legacy index.html:1852: fire when alive, not sprinting, and no sprint cooldown. Auto fires while held.
    const trigger = requested || (cmd.buttons.fire && weapon.def.auto);
    if (trigger && P.alive && !P.sprinting && P.sprintCool <= 0) {
      const result = tryFire(weapon, {
        ads: cmd.buttons.ads,
        moving: P.moving,
        sprinting: P.sprinting,
        perk: loadout.perk,
      });
      if (result !== null) fireShot();
    }
  };

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const frameDt = last === null ? 0 : (now - last) / 1000;
    last = now;

    if (state === 'play') {
      const look = mouse.drainLook();
      applyLook(look.dx, look.dy);
      for (const code of keyboard.drainPressed()) pendingPressed.add(code);
      const steps = step.advance(frameDt);
      for (let i = 0; i < steps; i++) simStep(i === 0);
    } else {
      keyboard.drainPressed();
      mouse.drainLook();
    }

    // Interpolate the rendered position between the last two sim states.
    const a = step.alpha;
    camera.position.set(
      lerp(prevX, P.pos.x, a),
      lerp(prevY, P.pos.y, a) + P.eyeHeight,
      lerp(prevZ, P.pos.z, a),
    );
    camera.rotation.set(P.pitch, P.yaw + Math.PI, 0, 'YXZ');
    renderer.render(scene, camera);
  };

  if (opts.debug) {
    installDebugHook({
      player: () => P,
      shots: () => shots,
      hits: () => hits,
      state: () => state,
    });
  }

  // Requested on the Launch click, so the browser treats it as a user gesture. Refusal is not an error.
  void lock.request();
  raf = requestAnimationFrame(frame);

  return {
    state: () => state,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      keyboard.detach();
      mouse.detach();
      lock.detach();
      unsubscribeLock();
      overlay.removeEventListener('click', onOverlayClick);
      canvas.removeEventListener('mousedown', onCanvasMouseDown);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      root.replaceChildren();
    },
  };
}
