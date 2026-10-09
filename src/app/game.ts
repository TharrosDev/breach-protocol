/*
 * Phase 3 integration. Decisions on the open deviations, for review:
 *
 * (a) Spread. The 'shoot' event carries `spread`, set by ai/hostile.ts with shotSpread(). combat.ts
 *     resolveEnemyShot applies that value and no other, so the AI's aim and the hit test use one number.
 *     The player's spread and recoil come from tryFire and the legacy fire code (index.html:1809-1826).
 * (b) shareIntel. Kept as legacy (index.html:3263-3268). A hostile that spots the player alerts hostiles within
 *     18 m. It writes state on other hostiles inside stepHostile, so later hostiles in the same tick see it.
 * (c) Aim points. Player body: feet + eye height x 0.6 (index.html:2226), used for both the aim and the hit
 *     test. Operator body: 0.95 for the hit sphere (index.html:1857-1866) and for the enemy's aim at an
 *     operator. Operators aim at enemies at 1.0 (index.html:2426). That is the legacy aim, kept as is.
 * (d) Path budget. GridNav.findPath spends one token from the budget it is given (grid.ts). Hostile movement
 *     passes the tick budget straight through. Squad goTo spends its own token and passes an always-granting
 *     budget to findPath, so each search is charged once.
 *
 * Other choices made while integrating:
 * - Dummy targets from phase 2 are removed. Real hostiles stand in their place, and the debug hits counter
 *   now counts bullets that hit a hostile.
 * - Player fire follows legacy: one ray per pellet, spread, recoil, the first hostile before the first wall
 *   takes the hit, damage from hitDamage (falloff and headshot), noise alerts at 40 m (8 m suppressed).
 * - Reload (R) runs on the sim step, as legacy does.
 * - Enemy frag grenades are simulated in sim/world.ts (index.html:1938-1981). Player gadgets are phase 4.
 * - Match end: enemy tickets at 0 win, and running out of reinforcements loses (index.html:2958, 1648).
 *   Zone capture is phase 4 and is not implemented, so zones never capture. After a result the match
 *   restarts after 4 s. The debrief screen is phase 5.
 * - Score, killstreaks and drone or UAV spotting are phase 4. Spotted hostiles are not drawn yet.
 */
import * as THREE from 'three';
import { FixedStep } from '../core/clock';
import { createRng } from '../core/rng';
import type { Vec3 } from '../core/math';
import { SIDEARM_ID } from '../content/ids';
import { getMap } from '../content/maps';
import { buildMap, buildingRects, type Footprint, type MapHandle } from '../render/map-builder';
import { WEAPONS } from '../content/weapons';
import { YAW_PER_PX } from '../content/tuning';
import { ENEMY_DEFS } from '../content/enemies';
import { DIFF } from '../content/difficulty';
import { Bindings } from '../input/bindings';
import { buildCommand } from '../input/commands';
import { KeyboardInput } from '../input/keyboard';
import { MouseInput } from '../input/mouse';
import { PointerLock } from '../input/pointer-lock';
import { loadBindings, loadLoadout, loadSettings, saveSettings } from '../persist/store';
import type { Quality } from '../persist/schema';
import { applyEnvironment, createPostChain, type PostChain } from '../render/post';
import { profileFor, type QualityProfile } from '../render/quality';
import { buildGrass } from '../render/grass';
import { buildLamps } from '../render/lamps';
import { buildBlobs, type BlobBox } from '../render/blobs';
import { RainField, buildRain } from '../render/rain';
import { ParticlePool, buildParticles } from '../render/particles';
import { DebrisField, buildDebrisMeshes } from '../render/debris';
import { HoleField, buildHoleMeshes } from '../render/holes';
import { CasingField } from '../render/casings';
import { buildCasingMeshes, makeHoleTexture } from '../render/fx-assets';
import {
  ShockwaveField,
  TracerPool,
  buildShockwaveMeshes,
  buildTracerMeshes,
  tracerSegment,
} from '../render/tracers';
import { createRenderer } from '../render/renderer';
import {
  applyLook as applyViewmodelLook,
  createViewmodel,
  gunPose,
  isScoped,
  stepViewmodel,
} from '../render/viewmodel';
import { buildGunModel, type GunModel } from '../render/gun-models';
import {
  animateHuman,
  makeHumanRig,
  placeHumanEnemy,
  type HumanPlaceState,
  type HumanRig,
} from '../render/humans';
import { createContextLossHandler } from '../render/context-loss';
import { CollisionWorld } from '../sim/collision';
import type { Enemy } from '../sim/entities';
import type { WeaponState } from '../sim/weapons';
import { SimWorld, type SimEvent, type SimEvents } from '../sim/world';
import { installDebugHook, type GameState } from './debug-hook';
import { DEFAULT_GOVERNOR_OPTIONS, FpsGovernor } from './governor';
import {
  MUZZLE_TIME,
  TRACER_START,
  bobSpeed,
  capDt,
  hemiIntensityFor,
  reloadProgress,
  reloadTotal,
  viewmodelVisible,
} from './wiring';

export interface GameHandle {
  state(): GameState;
  dispose(): void;
}

// Team spawn from legacy index.html:1090. The yaw faces the compound; legacy spawn yaw is not part of this task.
const SPAWN: Vec3 = { x: 0, y: 0, z: 46 };
const SPAWN_YAW = Math.PI;
// Pitch clamp from legacy index.html:3015.
const PITCH_LIMIT = 1.45;
// Legacy OPERATOR_COLOR (index.html:531).
const OPERATOR_COLOUR = 0x2f6b8a;
// Legacy ORDERS (index.html:473).
const ORDER_NAMES = ['ATTACK', 'HOLD', 'FOLLOW'] as const;
// Real time before a finished match restarts (the debrief screen is phase 5).
const RESTART_DELAY_S = 4;
// Legacy trackFps samples every 0.5 s (index.html:2962). The governor takes the same window.
const FPS_WINDOW = DEFAULT_GOVERNOR_OPTIONS.sampleSeconds;
const FPS_STALL_S = 1;
const DOWNGRADE_MESSAGE = 'Graphics lowered to keep the framerate up';
const CONTEXT_LOST_MESSAGE = 'Graphics reset. Restoring…';
const TOAST_MS = 3000;
// Legacy muzzle light (index.html:656, 2918-2924).
const MUZZLE_COLOR = 0xffb060;
const MUZZLE_INTENSITY = 3;
const MUZZLE_DISTANCE = 6;
const MUZZLE_DECAY = 2;
const PARTICLE_POOL = 500;
// Legacy impact (index.html:1378-1381): a bright spark burst and a dust burst.
const SPARK_BURST = { n: 6, speed: 3.2, hex: 0xffc878, life: 0.3, up: 0 };
const DUST_BURST = { n: 3, speed: 0.9, hex: 0x9a9488, life: 0.7, up: 0.4 };
// Legacy damageEnemy blood burst (index.html:2525) and grenade blast (index.html:1972).
const BLOOD_BURST = { n: 10, speed: 2.5, hex: 0x8a1212, life: 0.5, up: 0 };
const FRAG_BURST = { n: 60, speed: 8, hex: 0xff5a3a, life: 0.8, up: 0 };
// The rain only runs on the Substation map (legacy index.html:3156).
const RAIN_MAP = 'substation';
// Hostile body height used for the blood burst (index.html:2525).
const BLOOD_Y = 1.2;
// Crouch distance for a hostile hiding in cover (index.html:2338).
const HIDING_REACH = 0.9;
// index.html:1728 (ADS blend rate with Reflex). The loadout is fixed to VX with Reflex, as in phase 1.
const ADS_RATE_REFLEX = 17;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// The point `d` metres from `from` toward `to` (clamped to the segment).
function pointAlong(from: Vec3, to: Vec3, d: number): Vec3 {
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (len <= 0) return { ...from };
  const k = Math.min(d, len) / len;
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    z: from.z + (to.z - from.z) * k,
  };
}

// Unit vector from a to b, or (0, 0, 1) when they coincide.
function unitDir(a: Vec3, b: Vec3): Vec3 {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  if (len <= 0) return { x: 0, y: 0, z: 1 };
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len, z: (b.z - a.z) / len };
}

// Blob shadows need the colliders as boxes. CollisionWorld does not expose them, so rebuild the same list.
function footprintBox(f: Footprint): BlobBox {
  return {
    min: { x: f.x - f.w / 2, y: 0, z: f.z - f.d / 2 },
    max: { x: f.x + f.w / 2, y: f.h, z: f.z + f.d / 2 },
    breakable: false,
  };
}

// Calls fn for every material on a scene object. Used for disposal and for the shader refresh on quality change.
function forEachMaterial(scene: THREE.Scene, fn: (m: THREE.Material) => void): void {
  scene.traverse((o) => {
    const mat = (o as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }).material;
    if (mat === undefined) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) fn(m);
  });
}

function findHemi(scene: THREE.Scene): THREE.HemisphereLight | null {
  return scene.children.find((c): c is THREE.HemisphereLight => c instanceof THREE.HemisphereLight) ?? null;
}

function findSun(scene: THREE.Scene): THREE.DirectionalLight | null {
  return scene.children.find((c): c is THREE.DirectionalLight => c instanceof THREE.DirectionalLight) ?? null;
}

// One match. startGame keeps one of these alive and replaces it after a WebGL context restore.
interface Session {
  state(): GameState;
  dispose(): void;
}

// Render state for one hostile or operator. The sim owns the positions and states; these are render-only.
interface HumanView {
  rig: HumanRig;
  fall: number;
  tumble: -1 | 1;
  kick: number;
  crouch: number;
  phase: number;
}

// Starts the match loop inside root. Returns a handle for tests and teardown.
export function startGame(root: HTMLElement, opts: { debug: boolean }): GameHandle {
  let session: Session | null = null;
  let closed = false;

  // Restore strategy: when the browser restores the WebGL context, the old renderer and every GPU
  // resource are dead. The match is rebuilt in the same root (dispose, then start again). The rebuilt
  // match starts in play, and the score and the player position reset.
  const launch = (): void => {
    session = runSession(root, opts, () => {
      session?.dispose();
      session = null;
      if (!closed) launch();
    });
  };
  launch();

  return {
    state: () => session?.state() ?? 'play',
    dispose: () => {
      closed = true;
      session?.dispose();
      session = null;
    },
  };
}

function runSession(root: HTMLElement, opts: { debug: boolean }, onContextRestored: () => void): Session {
  const settings = loadSettings();
  const bindings = new Bindings(loadBindings());
  const loadout = loadLoadout();
  const map = getMap(loadout.map);

  root.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.className = 'play-canvas';
  const overlay = document.createElement('button');
  overlay.type = 'button';
  overlay.className = 'pause-overlay';
  overlay.textContent = 'Click to resume';
  overlay.hidden = true;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  root.append(canvas, overlay, toast);

  let quality: Quality = settings.quality;
  let profile: QualityProfile = profileFor(quality, window.devicePixelRatio);

  const renderer = createRenderer(canvas);
  renderer.setPixelRatio(profile.pixelRatioCap);
  renderer.shadowMap.enabled = profile.shadows;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 400);
  // The viewmodel is a child of the camera, so the camera has to be part of the scene graph.
  scene.add(camera);

  const world = new CollisionWorld();
  // Legacy index.html:439 uses Math.random for every map build, so the match layout is random too.
  const mapRng = createRng(Math.floor(Math.random() * 0x100000000));
  const mapH: MapHandle = buildMap(map, scene, world, mapRng);
  const hemi = findHemi(scene);
  const sun = findSun(scene);
  if (sun) sun.castShadow = profile.shadows;

  const zones = mapH.zones;
  // Lamps before grass, so the grass avoids the poles (phase 2 build order). Lamp poles are colliders.
  const lamps = buildLamps(scene, mapRng.fork('lamps'), profile.lampCount, world, zones);
  // The grass stream is forked from the map stream, which is not advanced by fork. A rebuild with another
  // count therefore reuses the same seed, and the first placements match.
  let grass = buildGrass(scene, mapRng.fork('grass'), profile.grassCount, world, zones);

  // The sim is built after the lamps, so its navigation grid sees every collider.
  const difficulty = DIFF[loadout.difficulty];
  const sim = new SimWorld({
    collision: world,
    zones: zones.map((z) => ({ x: z.x, z: z.z })),
    spawns: mapH.spawns,
    buildings: buildingRects(map),
    rng: mapRng.fork('sim'),
    difficulty,
    weapon: WEAPONS.vx,
    attachment: 'reflex',
    perk: loadout.perk,
    adsRate: ADS_RATE_REFLEX,
    playerSpawn: SPAWN,
    playerYaw: SPAWN_YAW,
  });
  const P = sim.player;
  const weaponNow = (): WeaponState => sim.weapon;

  const blobBoxes: BlobBox[] = [
    ...map.boxes,
    ...mapH.crates.map(footprintBox),
    ...mapH.sandbags.map(footprintBox),
    ...mapH.barrels.map((b) => {
      const cr = b.r * 0.9;
      return {
        min: { x: b.x - cr, y: 0, z: b.z - cr },
        max: { x: b.x + cr, y: b.h, z: b.z + cr },
        breakable: false,
      };
    }),
  ];
  // Blob meshes are freed with the rest of the scene on dispose.
  buildBlobs(scene, blobBoxes);

  const rainField = new RainField(mapRng.fork('rain'));
  const rain = buildRain(scene, rainField);

  // Weapons and the viewmodel. Both models are built; the primary is shown, and the sidearm is hidden.
  const gunRoot = new THREE.Group();
  camera.add(gunRoot);
  const primaryModel = buildGunModel(WEAPONS.vx.id);
  const sidearmModel = buildGunModel(SIDEARM_ID);
  gunRoot.add(primaryModel.group, sidearmModel.group);
  const muzzle = new THREE.PointLight(MUZZLE_COLOR, 0, MUZZLE_DISTANCE, MUZZLE_DECAY);
  let shown: GunModel = primaryModel;
  const showGun = (model: GunModel): void => {
    primaryModel.group.visible = model === primaryModel;
    sidearmModel.group.visible = model === sidearmModel;
    shown = model;
    // The muzzle light follows the shown gun, at the muzzle tip (legacy MUZZLE.position, index.html:1919).
    model.group.add(muzzle);
    muzzle.position.set(0, 0, model.muzzleZ);
  };
  showGun(primaryModel);
  muzzle.visible = profile.muzzleLight;
  const vm = createViewmodel();

  const step = new FixedStep(60);

  // Effects. Pools are created here and updated each frame; the sim step only emits.
  const fxRng = mapRng.fork('fx');
  const particles = new ParticlePool(PARTICLE_POOL);
  const particleView = buildParticles(scene, particles);
  const debris = new DebrisField();
  const debrisView = buildDebrisMeshes(scene, debris);
  const holes = new HoleField();
  const holeView = buildHoleMeshes(scene, holes, makeHoleTexture);
  const casings = new CasingField();
  const casingView = buildCasingMeshes(scene, casings);
  const tracers = new TracerPool();
  const tracerView = buildTracerMeshes(scene, tracers);
  // Shockwaves are wired for the explosions that come with the gadgets (phase 4). Enemy frags only flash.
  const shock = new ShockwaveField();
  const shockView = buildShockwaveMeshes(scene, shock);

  // Hostile and operator bodies. Enemy rigs are created when the sim spawns an enemy and removed when it drops one.
  const enemyViews = new Map<Enemy, HumanView>();
  const operatorViews: HumanView[] = sim.operators.map(() => {
    const rig = makeHumanRig('operator', OPERATOR_COLOUR);
    scene.add(rig.group);
    return {
      rig,
      fall: 0,
      tumble: fxRng.next() < 0.5 ? -1 : 1,
      kick: 0,
      crouch: 0,
      phase: fxRng.range(0, 6),
    };
  });

  const governor = new FpsGovernor();
  let post: PostChain | null = null;
  let viewW = 1;
  let viewH = 1;

  let state: GameState = 'play';
  // Presses and fire clicks are latched until a sim step consumes them. A frame can run zero steps.
  let pendingPressed = new Set<string>();
  let fireClick = false;
  let prevX = P.pos.x;
  let prevY = P.pos.y;
  let prevZ = P.pos.z;
  let last: number | null = null;
  let raf = 0;
  let disposed = false;
  let muzzleT = 0;
  let bobT = 0;
  let fpsFrames = 0;
  let fpsTime = 0;
  let toastTimer: number | null = null;
  // Seconds of real time until the finished match restarts, or null while a match runs.
  let restartIn: number | null = null;

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

  const showToast = (message: string): void => {
    toast.textContent = message;
    toast.hidden = false;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
      toastTimer = null;
    }, TOAST_MS);
  };

  // A lost context pauses play and shows the notice. The overlay cannot resume play until the context is back.
  const contextLoss = createContextLossHandler({
    onLost: () => {
      pause();
      overlay.textContent = CONTEXT_LOST_MESSAGE;
      overlay.hidden = false;
    },
    onRestored: () => {
      onContextRestored();
    },
  });
  contextLoss.attach(canvas);

  const onOverlayClick = (): void => {
    if (contextLoss.lost) return;
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
    viewW = Math.max(1, window.innerWidth);
    viewH = Math.max(1, window.innerHeight);
    renderer.setSize(viewW, viewH);
    camera.aspect = viewW / viewH;
    camera.updateProjectionMatrix();
    post?.setSize(viewW, viewH, profile.pixelRatioCap);
  };
  window.addEventListener('resize', onResize);
  onResize();

  // Hemisphere intensity follows the post chain. buildMap sets 0.9 until the chain has loaded.
  const setHemi = (postLoaded: boolean): void => {
    if (hemi) hemi.intensity = hemiIntensityFor(postLoaded);
  };

  // Rebuilds the grass at a new count (legacy applyQuality path, index.html:711-722).
  const rebuildGrass = (count: number): void => {
    scene.remove(grass);
    grass.geometry.dispose();
    const mat = grass.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.dispose();
    grass = buildGrass(scene, mapRng.fork('grass'), count, world, zones);
  };

  // Loads the post chain and the room environment for High. Failures leave the game running without post.
  // Accessors, so TypeScript does not narrow these flags across the await below.
  const postWanted = (): boolean => profile.post;
  const isGone = (): boolean => disposed;
  const initPost = async (): Promise<void> => {
    if (!postWanted()) {
      setHemi(false);
      return;
    }
    const chain = await createPostChain(renderer, scene, camera);
    if (isGone() || !postWanted() || chain === null) {
      chain?.dispose();
      if (!isGone()) setHemi(false);
      return;
    }
    post = chain;
    post.setSize(viewW, viewH, profile.pixelRatioCap);
    await applyEnvironment(renderer, scene);
    if (isGone()) return;
    // A downgrade during the await has already turned post off, so the environment must go too.
    if (!postWanted()) {
      scene.environment = null;
      return;
    }
    setHemi(true);
  };
  void initPost().catch((err: unknown) => {
    console.warn('Post setup failed; running without post.', err);
    setHemi(false);
  });

  // Auto-downgrade (legacy trackFps, index.html:2962-2977). Settings are saved, then the Low profile is applied.
  const downgrade = (): void => {
    if (disposed) return;
    quality = 'low';
    saveSettings({ ...loadSettings(), quality: 'low' });
    profile = profileFor('low', window.devicePixelRatio);
    if (post !== null) {
      post.dispose();
      post = null;
    }
    scene.environment = null;
    renderer.setPixelRatio(profile.pixelRatioCap);
    renderer.shadowMap.enabled = profile.shadows;
    if (sun) sun.castShadow = profile.shadows;
    setHemi(false);
    muzzle.visible = profile.muzzleLight;
    rebuildGrass(profile.grassCount);
    // Materials recompile for the new shadow setting, as legacy does (index.html:720).
    forEachMaterial(scene, (m) => {
      m.needsUpdate = true;
    });
    onResize();
    showToast(DOWNGRADE_MESSAGE);
  };

  // Legacy mousemove handler (index.html:3012-3016). Applied once per frame, not per fixed step.
  const applyLook = (dx: number, dy: number): void => {
    const s = YAW_PER_PX * settings.sens * lerp(1, settings.adsMul, P.adsT);
    P.yaw -= dx * s;
    P.pitch = clamp(P.pitch + (settings.invertY ? 1 : -1) * dy * s, -PITCH_LIMIT, PITCH_LIMIT);
  };

  const impact = (p: Vec3, dir: Vec3): void => {
    holes.add(p, dir);
    particles.emitBurst(
      p,
      SPARK_BURST.n,
      SPARK_BURST.speed,
      SPARK_BURST.hex,
      SPARK_BURST.life,
      SPARK_BURST.up,
      fxRng,
    );
    particles.emitBurst(
      p,
      DUST_BURST.n,
      DUST_BURST.speed,
      DUST_BURST.hex,
      DUST_BURST.life,
      DUST_BURST.up,
      fxRng,
    );
  };

  // Turns the sim's events into effects, toasts and the match restart. The sim has already applied them.
  const handleEvents = (events: SimEvents): void => {
    for (const ev of events) handleEvent(ev);
  };

  const handleEvent = (ev: SimEvent): void => {
    switch (ev.type) {
      case 'playerFire': {
        muzzleT = MUZZLE_TIME;
        // Legacy index.html:1828: the shotgun does not eject a casing.
        if (weaponNow().def.id !== 'bk')
          casings.eject({ x: P.pos.x, y: P.pos.y + P.eyeHeight, z: P.pos.z }, P.yaw, fxRng);
        return;
      }
      case 'bullet': {
        if (ev.tracer) tracers.add(tracerSegment(pointAlong(ev.from, ev.to, TRACER_START), ev.to));
        if (ev.wall) impact(ev.to, unitDir(ev.from, ev.to));
        return;
      }
      case 'enemyShot': {
        if (ev.tracer) tracers.add(tracerSegment(pointAlong(ev.from, ev.to, TRACER_START), ev.to));
        const v = enemyViews.get(ev.shooter);
        if (v !== undefined) v.kick = 1;
        return;
      }
      case 'operatorShot': {
        tracers.add(tracerSegment(pointAlong(ev.from, ev.to, TRACER_START), ev.to));
        return;
      }
      case 'enemyHit': {
        particles.emitBurst(
          { x: ev.enemy.pos.x, y: BLOOD_Y, z: ev.enemy.pos.z },
          BLOOD_BURST.n,
          BLOOD_BURST.speed,
          BLOOD_BURST.hex,
          BLOOD_BURST.life,
          BLOOD_BURST.up,
          fxRng,
        );
        return;
      }
      case 'grenadeBlast': {
        particles.emitBurst(
          ev.at,
          FRAG_BURST.n,
          FRAG_BURST.speed,
          FRAG_BURST.hex,
          FRAG_BURST.life,
          FRAG_BURST.up,
          fxRng,
        );
        return;
      }
      case 'playerDown': {
        showToast('You are down. Squadmate nearby can revive you.');
        return;
      }
      case 'playerEliminated': {
        showToast('You were eliminated');
        return;
      }
      case 'playerRevived': {
        showToast(`${ev.by} revived you`);
        return;
      }
      case 'playerRespawn': {
        // The respawn is a teleport: no interpolation across the map.
        prevX = P.pos.x;
        prevY = P.pos.y;
        prevZ = P.pos.z;
        return;
      }
      case 'operatorDown': {
        showToast(`${ev.operator.name} is down`);
        return;
      }
      case 'wave': {
        showToast(`Wave ${String(ev.wave)} inbound`);
        return;
      }
      case 'orderChanged': {
        showToast(`Squad: ${ORDER_NAMES[ev.order]}`);
        return;
      }
      case 'outcome': {
        showToast(ev.result === 'won' ? 'Sector secured' : 'Mission failed');
        restartIn = RESTART_DELAY_S;
        return;
      }
      default:
        return;
    }
  };

  const restartMatch = (): void => {
    sim.restart();
    restartIn = null;
    prevX = P.pos.x;
    prevY = P.pos.y;
    prevZ = P.pos.z;
    pendingPressed = new Set<string>();
    fireClick = false;
  };

  const simStep = (first: boolean): void => {
    const pressed: ReadonlySet<string> = first ? pendingPressed : new Set<string>();
    if (first) pendingPressed = new Set<string>();
    const cmd = buildCommand(keyboard.held(), mouse.buttons(), { dx: 0, dy: 0 }, pressed, bindings);

    prevX = P.pos.x;
    prevY = P.pos.y;
    prevZ = P.pos.z;
    const requested = fireClick;
    fireClick = false;
    handleEvents(sim.step(cmd, step.dt, requested));
  };

  // Reload progress for the viewmodel. Uses the perk-adjusted reload time.
  const currentReload = (): number =>
    reloadProgress(weaponNow().reloadLeft, reloadTotal(weaponNow().def.reload, loadout.perk));

  // Places every hostile and operator rig for this frame. Rigs follow the sim lists: a hostile that the sim
  // drops loses its rig here.
  const syncHumans = (fxDt: number): void => {
    const live = new Set<Enemy>(sim.enemies);
    for (const [e, v] of enemyViews) {
      if (!live.has(e)) {
        scene.remove(v.rig.group);
        enemyViews.delete(e);
      }
    }
    for (const e of sim.enemies) {
      let v = enemyViews.get(e);
      if (v === undefined) {
        const rig = makeHumanRig(e.kind, ENEMY_DEFS[e.kind].color);
        scene.add(rig.group);
        v = {
          rig,
          fall: 0,
          tumble: fxRng.next() < 0.5 ? -1 : 1,
          kick: 0,
          crouch: 0,
          phase: fxRng.range(0, 6),
        };
        enemyViews.set(e, v);
      }
      const hiding =
        e.cover !== null &&
        e.coverT > 0 &&
        Math.hypot(e.cover.x - e.pos.x, e.cover.z - e.pos.z) < HIDING_REACH;
      if (e.alive) {
        v.phase = animateHuman(
          v.rig,
          { phase: v.phase, moving: e.moving, aiming: e.engaged && e.unseenT === 0 },
          fxDt,
        );
      }
      const st: HumanPlaceState = {
        x: e.pos.x,
        z: e.pos.z,
        yaw: e.yaw,
        kick: v.kick,
        crouch: v.crouch,
        hiding,
        flinchT: e.flinchT,
        spot: e.spot,
        phase: v.phase,
        moving: e.moving,
        alive: e.alive,
        fall: v.fall,
        tumble: v.tumble,
        time: sim.time,
        dt: fxDt,
      };
      placeHumanEnemy(v.rig, st);
      v.fall = st.fall;
      v.kick = st.kick;
      v.crouch = st.crouch;
    }
    sim.operators.forEach((a, i) => {
      const v = operatorViews[i];
      if (v === undefined) return;
      if (a.alive) {
        // A revived operator stands up again (legacy reviveAlly sets fall to 0).
        v.fall = 0;
        v.phase = animateHuman(v.rig, { phase: v.phase, moving: a.moving, aiming: a.fireT > 0 }, fxDt);
      }
      const st: HumanPlaceState = {
        x: a.pos.x,
        z: a.pos.z,
        yaw: a.yaw,
        kick: v.kick,
        crouch: v.crouch,
        hiding: false,
        flinchT: 0,
        spot: 0,
        phase: v.phase,
        moving: a.moving,
        alive: a.alive,
        fall: v.fall,
        tumble: v.tumble,
        time: sim.time,
        dt: fxDt,
      };
      placeHumanEnemy(v.rig, st);
      v.fall = st.fall;
      v.kick = st.kick;
      v.crouch = st.crouch;
    });
  };

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const frameDt = last === null ? 0 : (now - last) / 1000;
    last = now;
    const inPlay = state === 'play';

    // FPS sampling over real time, so the 5 s slow window means 5 s on the clock. A frame longer than
    // FPS_STALL_S (a hidden tab or a debugger pause) restarts the window instead of counting as one slow frame.
    if (frameDt > 0 && frameDt <= FPS_STALL_S) {
      fpsFrames += 1;
      fpsTime += frameDt;
    } else {
      fpsFrames = 0;
      fpsTime = 0;
    }
    if (fpsTime >= FPS_WINDOW) {
      const fps = fpsFrames / fpsTime;
      fpsFrames = 0;
      fpsTime = 0;
      if (governor.sample(fps, inPlay, quality) === 'downgrade') downgrade();
    }

    // Effects and the viewmodel run on the clamped frame time, and stop while paused.
    const fxDt = inPlay ? capDt(frameDt) : 0;
    if (inPlay) {
      const look = mouse.drainLook();
      applyLook(look.dx, look.dy);
      applyViewmodelLook(vm, look.dx, look.dy);
      for (const code of keyboard.drainPressed()) pendingPressed.add(code);
      const steps = step.advance(frameDt);
      for (let i = 0; i < steps; i++) simStep(i === 0);
      bobT += fxDt * bobSpeed(P.sprinting, P.moving);
      muzzleT = Math.max(0, muzzleT - fxDt);
      // Spring dt is capped at 0.05 s (see fxDt above).
      stepViewmodel(vm, fxDt, currentReload());
    } else {
      keyboard.drainPressed();
      mouse.drainLook();
    }

    // A finished match restarts on real time, so the countdown runs while the sim is frozen.
    if (restartIn !== null) {
      restartIn -= frameDt;
      if (restartIn <= 0) restartMatch();
    }

    particles.update(fxDt);
    particleView.sync();
    debris.update(fxDt);
    debrisView.sync();
    casings.update(fxDt);
    casingView.sync();
    tracers.update(fxDt);
    tracerView.sync();
    shock.update(fxDt);
    shockView.sync();
    holeView.sync();
    syncHumans(fxDt);

    // Rain only on Substation at High, as legacy (index.html:3156).
    const rainOn = profile.rainOnSubstation && map.id === RAIN_MAP;
    rain.setVisible(rainOn);
    if (rainOn) rainField.update(fxDt, P.pos.x, P.pos.z);

    const pose = gunPose(vm, {
      adsT: P.adsT,
      moving: P.moving,
      bobT,
      switchT: 0,
      reloadProgress: currentReload(),
    });
    shown.group.position.set(pose.position[0], pose.position[1], pose.position[2]);
    shown.group.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2]);
    shown.mag.position.y = pose.magY;
    shown.group.visible = viewmodelVisible(P.alive, isScoped(weaponNow().def.id, P.adsT));
    muzzle.intensity = muzzleT > 0 ? MUZZLE_INTENSITY : 0;

    // Interpolate the rendered position between the last two sim states.
    const a = step.alpha;
    camera.position.set(
      lerp(prevX, P.pos.x, a),
      lerp(prevY, P.pos.y, a) + P.eyeHeight,
      lerp(prevZ, P.pos.z, a),
    );
    camera.rotation.set(P.pitch, P.yaw + Math.PI, 0, 'YXZ');

    if (!contextLoss.lost) {
      if (post !== null) post.render();
      else renderer.render(scene, camera);
    }
  };

  if (opts.debug) {
    installDebugHook({
      player: () => P,
      shots: () => sim.playerShots,
      hits: () => sim.playerHits,
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
      if (toastTimer !== null) window.clearTimeout(toastTimer);
      contextLoss.detach();
      keyboard.detach();
      mouse.detach();
      lock.detach();
      unsubscribeLock();
      overlay.removeEventListener('click', onOverlayClick);
      canvas.removeEventListener('mousedown', onCanvasMouseDown);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      post?.dispose();
      post = null;
      lamps.dispose();
      mapH.dispose();
      // The remaining meshes and materials are freed by walking the scene. Textures on materials go with them.
      scene.environment?.dispose();
      forEachMaterial(scene, (m) => {
        (m as THREE.Material & { map?: THREE.Texture | null }).map?.dispose();
        m.dispose();
      });
      scene.traverse((o) => {
        (o as THREE.Object3D & { geometry?: THREE.BufferGeometry }).geometry?.dispose();
      });
      renderer.dispose();
      root.replaceChildren();
    },
  };
}
