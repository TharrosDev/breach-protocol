/*
 * Phase 4 and Phase 5 integration. Deviations from the legacy game (public/index.html) and decisions for review:
 *
 * Phase 5 (shell, HUD, accessibility):
 * (p) Screens. The menu, brief, loadout, settings, pause and debrief are the modules in ui/screens. The flow is in
 *     app/shell.ts. Redeploy starts the match at once, without the brief (legacy redeploy, index.html:3041). Main
 *     menu leaves the match and shows the menu.
 * (q) HUD. createHud (ui/hud/hud.ts) reads a view built from the sim each frame (app/hud-view.ts). The sim is never
 *     written by the HUD. The kill feed replaces the Phase 2-4 toast. Game messages are feed lines, and the legacy
 *     banners (multi-kill, killstreak, squad order, revive) are announce banners.
 * (r) Pause. Esc, or losing a pointer lock that was held, pauses the match and shows the pause screen (Resume,
 *     Settings, Abort to menu). Legacy used a click-to-resume overlay. A pause releases the pointer lock, so the mouse
 *     reaches the pause screen. A refused pointer lock does not pause the match: a feed line says so instead (spec §4
 *     asks for a pause on refusal; the existing E2E tests run where the lock is refused and expect play, so this is
 *     left for review).
 * (ab) A paused or finished match draws its last frame once and holds it (the pause and debrief screens sit on top).
 *     Software GL is slow enough to starve the page while it draws every frame. Legacy redrew every frame.
 * (s) Settings apply live: sensitivity, ADS multiplier, invert Y, FOV, the colour-blind palette (zones, HUD, markers),
 *     the FPS counter and screen shake. Graphics quality applies live too, through applyQuality, which rebuilds what
 *     the quality tier changes (post chain, zone light, grass, shadows).
 * (t) Screen shake. The camera moves by up to 0.06 m times the shake value, which is raised to 0.15 on each hit taken
 *     (legacy P.shake, index.html:1625 and 1776-1777) and decays at 2 per second.
 * (u) Feed messages for graphics downgrade, a refused pointer lock and a lost WebGL context (legacy toasts were not
 *     kept; spec §1.6 asks for the feed).
 * (v) Hit markers and hit numbers are shown for player hits only (legacy hitNumber in the player's bullet code,
 *     index.html:1878). Damage indicators point at the source of each hit taken (legacy addDmgIndicator).
 * (w) The HUD operator count includes the player, as the legacy line does (index.html:2888: "OPERATORS n/3").
 * (x) Accuracy in the debrief uses the legacy counts: one shot per trigger pull and one hit per bullet that hits a
 *     hostile. With the Breaker shotgun (nine pellets) hits can outnumber shots, so the accuracy can exceed 100%.
 *     Kept as legacy; left for review.
 * (y) Loadout. The primary weapon and attachment come from the saved loadout (Phase 4 used the VX with Reflex). The ADS
 *     rate is 17 with Reflex and 12 without (spec §1.2). Keys 1 and 2 switch the primary and the sidearm (sim/world.ts
 *     requestSwitch, legacy switchWeapon). The viewmodel lowers the gun during the 0.35 s switch and shows the gun in
 *     hand. The sidearm has no attachment, as legacy.
 * (z) Scoreboard. The Tab scoreboard (legacy updScoreboard, index.html:2885-2900) is a HUD table shown while the key is
 *     held in play. Rows and footer come from app/hud-view.ts; the table is in ui/hud/hud.ts.
 * (aa) The map layout is still seeded from Math.random, as in legacy (index.html:439). It is in the app layer, not in
 *     sim/ or content/. Left for review, because the seeded layout would change what the players see today.
 *
 * Phase 6 (audio, spec §1.7):
 * (ac) Sound. The sim reports events and this file maps them to sounds (app/sound-map.ts), then plays them through
 *     app/sound.ts. The audio graph is made once per page on the first click or key press (app/shell.ts). With no
 *     audio the match runs silent. Sim changes for the sounds: playerFire now carries the weapon and whether it is
 *     suppressed, and two events are new: grenadeDetonated (flash and smoke) and medkitUsed.
 *     Deviations from legacy, for review:
 *     - The knife plays its swing on every swing, hit or miss (the sim's 'melee' event, sim/melee.ts).
 *     - A medkit sounds only when it heals. The sim ignores a medkit at full health (sim/gadgets.ts). Legacy
 *       useMedkit played the tone on every use.
 *     - The kill tone is played for kills by operators as well as by the player, as legacy damageEnemy does.
 *     - The graph is made on the first gesture, so the volume and mute are applied then, not at page load. Before
 *       any gesture there is no context to set them on.
 *
 * Phase 4 (match rules):
 * (e) Zone visuals. Built per zone (render/zones.ts). The point light is High quality only, as the plan says; a
 *     downgrade rebuilds the zones without it. Colour-blind palette from the saved setting (legacy zoneColor,
 *     index.html:1026), read each frame.
 * (f) Debrief. The debrief screen shows the legacy tiles (index.html:396-412, 2641-2658) from the match result.
 *     The heading uses 'Mission Failed' from index.html:2648 (the Phase 3 toast said 'Mission failed').
 * (g) Match end. The match stops on the result and waits for the player. Phase 3 restarted it after 4 s. Legacy
 *     never restarts on its own (it shows the debrief).
 * (h) Redeploy. Builds a new session: new map layout, fresh state and a fresh renderer. Legacy's redeploy rebuilt
 *     the map too (index.html:2687-2690, 3041).
 * (i) Killstreak feedback. Legacy shows announce banners and feed lines (index.html:2019-2050). The UAV and sentry
 *     timers are shown through the HUD (Phase 5).
 * (j) Crates. A used resupply crate hides for its 30 s cooldown (legacy k.mesh.visible, index.html:3230).
 * (k) Breach. A broken wall's mesh is removed. The collider and the nav grid are updated by the sim.
 * (l) Spotted hostiles are revealed to the sim (UAV and drone spot values). The HUD draws the spotted boxes.
 * (m) Flashbang. The player's blindness is stored in the sim (flashT). The HUD whiteout is flashT / 3 (legacy).
 * (n) Groundaim. The sentry and airstrike aim use legacy groundAim (index.html:1303-1310). For a level aim it is
 *     8 m ahead whatever the distance, so the 6, 4 and 2 m sentry fallbacks only apply to downward aims. Kept as
 *     legacy.
 * (o) Score for player kills from gadgets, breach, airstrikes and sentries is the same as for bullets (kill 100,
 *     headshot +50 for sentry shots). Revive +150 and zone capture +250 follow the spec.
 *
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
 * - Enemy frag grenades are simulated in sim/world.ts (index.html:1938-1981), and so are the player's gadgets.
 * - Match end: sim/tickets.ts decides win (enemy tickets 0, or every zone captured) and loss (dead with no
 *   reinforcements left, index.html:2958, 1648). The end is shown on the debrief, see (f) and (g).
 */
import * as THREE from 'three';
import { FixedStep } from '../core/clock';
import { createRng } from '../core/rng';
import type { Vec3 } from '../core/math';
import { SIDEARM_ID, type Action } from '../content/ids';
import { getMap } from '../content/maps';
import type { MapDef } from '../content/maps/types';
import { buildMap, buildingRects, type Footprint, type MapHandle } from '../render/map-builder';
import { WEAPONS } from '../content/weapons';
import { YAW_PER_PX, ZONE_TICKET_COST } from '../content/tuning';
import { ENEMY_DEFS } from '../content/enemies';
import { DIFF } from '../content/difficulty';
import type { Bindings } from '../input/bindings';
import { buildCommand } from '../input/commands';
import { KeyboardInput } from '../input/keyboard';
import { MouseInput } from '../input/mouse';
import { GamepadInput } from '../input/gamepad';
import { MatchTally, buildMatchStats, type MatchStats } from '../progress/tally';
import { PointerLock } from '../input/pointer-lock';
import type { Loadout, Quality, Settings } from '../persist/schema';
import { applyEnvironment, createPostChain, type PostChain } from '../render/post';
import { profileFor, type QualityProfile } from '../render/quality';
import { buildGrass } from '../render/grass';
import { buildLamps } from '../render/lamps';
import { buildBlobs, type BlobBox } from '../render/blobs';
import { RainField, buildRain } from '../render/rain';
import { classifySurface, createFxHub, type FxHub } from '../render/vfx';
import { buildAtmosphere } from '../render/atmosphere';
import { addTrauma, createCameraFeel, stepCameraFeel } from '../render/camera-feel';
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
import { createStreakFx } from '../render/streak-fx';
import {
  applyLook as applyViewmodelLook,
  createViewmodel,
  gunPose,
  isScoped,
  stepViewmodel,
  kickViewmodel,
} from '../render/viewmodel';
import { buildGunModel, flashMuzzle, poseGun, type GunModel } from '../render/gun-models';
import {
  animateHuman,
  flashHuman,
  makeHumanRig,
  placeHumanEnemy,
  type HumanPlaceState,
  type HumanRig,
} from '../render/humans';
import { createContextLossHandler } from '../render/context-loss';
import { buildZoneVisual, type ZoneVisual } from '../render/zones';
import {
  breachMarker,
  claymoreModel,
  droneModel,
  grenadeMesh,
  smokeCloud,
  type BreachMarker,
  type ClaymoreModel,
  type DroneModel,
  type GrenadeKind as GrenadeViewKind,
  type SmokeCloud as SmokeCloudView,
} from '../render/gadget-models';
import { turretModel, type TurretModel } from '../render/turret-model';
import { CollisionWorld } from '../sim/collision';
import type { Enemy } from '../sim/entities';
import type { Grenade, SmokeCloud } from '../sim/grenades';
import type { MatchResult } from '../sim/match';
import type { Turret } from '../sim/turret';
import type { Mine } from '../sim/mines';
import type { WeaponState } from '../sim/weapons';
import { SimWorld, type SimEvent, type SimEvents } from '../sim/world';
import { installDebugHook, type GameState } from './debug-hook';
import { DEFAULT_GOVERNOR_OPTIONS, FpsGovernor } from './governor';
import {
  HudState,
  KILLSTREAK_USED,
  SQUAD_ORDER_NAMES,
  buildHudExtras,
  buildHudView,
  introKeys,
  type HudEnv,
} from './hud-view';
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
import { createHud, type Hud } from '../ui/hud/hud';
import { addDamageIndicator, addHitNumber } from '../ui/hud/effects';
import type { ColourMode } from '../ui/contracts';
import type { ScreenPoint, WorldProjector } from '../ui/hud/layout';
import { readyLabel } from '../sim/killstreaks';
import { keyLabel } from '../ui/screens/model';
import type { SoundEvent } from '../audio';
import { mapSimEventToSound } from './sound-map';

// The live settings and bindings. The shell owns them and passes them in, so a change on the settings screen
// reaches a running match at the next frame.
export interface LiveSettings {
  readonly settings: Settings;
  readonly bindings: Bindings;
}

// The page's sound, as the match uses it. The shell passes its AppSound (app/sound.ts).
export interface MatchSound {
  play(ev: SoundEvent): void;
}

// What a match asks of the shell.
export interface MatchHooks {
  // The current settings and bindings, read each frame.
  live(): LiveSettings;
  // Saves a settings change made by the match itself (the auto-downgrade).
  patchSettings(patch: Partial<Settings>): void;
  // Plays the sounds the match's events make.
  sound: MatchSound;
  // The match paused: the shell shows the pause screen.
  onPause(): void;
  // The match resumed: the shell hides the pause screen.
  onResume(): void;
  // The match ended: the shell shows the debrief. The match stops until the shell disposes it.
  onOver(result: MatchResult, stats: MatchStats): void;
}

export interface MatchOptions extends MatchHooks {
  readonly debug: boolean;
  readonly loadout: Loadout;
}

export interface GameHandle {
  state(): GameState;
  // Resume from the pause screen. Asks for the pointer lock too, because the click is a user gesture.
  resume(): void;
  dispose(): void;
}

// Team spawn from legacy index.html:1090. The yaw faces the compound; legacy spawn yaw is not part of this task.
const SPAWN: Vec3 = { x: 0, y: 0, z: 46 };
const SPAWN_YAW = Math.PI;
// Pitch clamp from legacy index.html:3015.
const PITCH_LIMIT = 1.45;
// Legacy OPERATOR_COLOR (index.html:531).
const OPERATOR_COLOUR = 0x2f6b8a;
// Legacy trackFps samples every 0.5 s (index.html:2962). The governor takes the same window.
const FPS_WINDOW = DEFAULT_GOVERNOR_OPTIONS.sampleSeconds;
const FPS_STALL_S = 1;
const DOWNGRADE_MESSAGE = 'Graphics lowered to keep the framerate up';
const CONTEXT_LOST_MESSAGE = 'Graphics reset. Restoring…';
const POINTER_REFUSED_MESSAGE = 'Mouse capture was refused. Click the game to capture the mouse.';
const FRAME_FAULT_MESSAGE =
  'Something went wrong. The match is paused; resume to keep playing or leave to the menu.';
// Legacy muzzle light (index.html:656, 2918-2924).
const MUZZLE_COLOR = 0xffb060;
const MUZZLE_INTENSITY = 3;
const MUZZLE_DISTANCE = 6;
const MUZZLE_DECAY = 2;
// The rain only runs on the Substation map (legacy index.html:3156).
const RAIN_MAP = 'substation';
// Hostile body height used for the blood burst (index.html:2525).
const BLOOD_Y = 1.2;
// Height of a hit number above the hostile's feet (index.html:3389-3391, 1.6 m).
const HIT_NUMBER_Y = 1.6;
// Crouch distance for a hostile hiding in cover (index.html:2338).
const HIDING_REACH = 0.9;
// index.html:1728 (ADS blend rate with Reflex). Without Reflex the rate is 12 (spec §1.2).
const ADS_RATE_REFLEX = 17;
const ADS_RATE_PLAIN = 12;
// Low-health ramp for the screen grade: 0 above 40 % health, 1 at zero.
const lowHealth = (hp: number): number => clamp(1 - hp / 40, 0, 1);

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

// The mesh kind for a sim grenade: enemy frags have their own colour (gadget-models.ts).
function grenadeViewKind(g: Grenade): GrenadeViewKind {
  if (g.kind === 'frag') return g.owner === 'enemy' ? 'enemyFrag' : 'frag';
  return g.kind;
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

function paletteOf(settings: Settings): ColourMode {
  return settings.colorblind ? 'colourblind' : 'normal';
}

// One match. startGame keeps one of these alive and replaces it after a WebGL context restore.
interface Session {
  state(): GameState;
  resume(): void;
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

// Starts the match loop inside stage. Returns a handle for the shell. The stage element is owned by the match while
// it runs: the canvas and the HUD are added to it and removed on dispose.
export function startGame(stage: HTMLElement, opts: MatchOptions): GameHandle {
  let session: Session | null = null;
  let closed = false;

  // Restore strategy: when the browser restores the WebGL context, the old renderer and every GPU
  // resource are dead. The match is rebuilt in the same stage (dispose, then start again). The rebuilt
  // match starts in play, and the score and the player position reset.
  const restart = (): void => {
    session?.dispose();
    session = null;
    if (!closed) launch();
  };

  const launch = (): void => {
    session = runSession(stage, opts, { onContextRestored: restart });
  };
  launch();

  return {
    state: () => session?.state() ?? 'play',
    resume: () => {
      session?.resume();
    },
    dispose: () => {
      closed = true;
      session?.dispose();
      session = null;
    },
  };
}

function runSession(
  stage: HTMLElement,
  opts: MatchOptions,
  hooks: { onContextRestored: () => void },
): Session {
  const doc = stage.ownerDocument;
  const initial = opts.live();
  const loadout = opts.loadout;
  const map: MapDef = getMap(loadout.map);
  const difficulty = DIFF[loadout.difficulty];

  stage.replaceChildren();
  const canvas = doc.createElement('canvas');
  canvas.className = 'play-canvas';
  const hudRoot = doc.createElement('div');
  stage.append(canvas, hudRoot);

  let liveNow: LiveSettings = initial;
  let quality: Quality = initial.settings.quality;
  let profile: QualityProfile = profileFor(quality, window.devicePixelRatio);

  const renderer = createRenderer(canvas);
  renderer.setPixelRatio(profile.pixelRatioCap);
  renderer.shadowMap.enabled = profile.shadows;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(initial.settings.fov, 1, 0.05, 400);
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
  const weapon = WEAPONS[loadout.primary];
  const sim = new SimWorld({
    collision: world,
    zones,
    spawns: mapH.spawns,
    buildings: buildingRects(map),
    rng: mapRng.fork('sim'),
    difficulty,
    weapon,
    attachment: loadout.attachment,
    perk: loadout.perk,
    adsRate: loadout.attachment === 'reflex' ? ADS_RATE_REFLEX : ADS_RATE_PLAIN,
    playerSpawn: SPAWN,
    playerYaw: SPAWN_YAW,
    gadgets: loadout.gadgets,
    crates: mapH.pickups,
    mapName: map.name,
  });
  const P = sim.player;
  const weaponNow = (): WeaponState => sim.weapon;

  // Capture-zone visuals (render/zones.ts). The light is High quality only, so a downgrade rebuilds the zones.
  let zoneViews: ZoneVisual[] = [];
  const buildZones = (withLight: boolean): void => {
    for (const v of zoneViews) v.dispose();
    zoneViews = sim.zones.map((z) => buildZoneVisual(scene, z, withLight));
  };
  buildZones(quality === 'high');

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

  // Weapons and the viewmodel. Both models are built; the gun in hand is shown (see frame()).
  const gunRoot = new THREE.Group();
  camera.add(gunRoot);
  const primaryModel = buildGunModel(weapon.id);
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
  let fx: FxHub = createFxHub(scene, profile, fxRng.fork('hub'));
  const feel = createCameraFeel();
  let muzzleSeed = 0;
  let fovDelta = 0;
  let fxClock = 0;
  const atmosphere = buildAtmosphere(scene, map, profile, mapRng.fork('atmo'), world, sun, hemi);
  const debris = new DebrisField();
  const debrisView = buildDebrisMeshes(scene, debris);
  const holes = new HoleField();
  const holeView = buildHoleMeshes(scene, holes, makeHoleTexture);
  const casings = new CasingField();
  const casingView = buildCasingMeshes(scene, casings);
  const tracers = new TracerPool();
  const tracerView = buildTracerMeshes(scene, tracers, profile.glow);
  // Shockwaves are wired for the explosions that come with the gadgets (phase 4). Enemy frags only flash.
  const shock = new ShockwaveField();
  const shockView = buildShockwaveMeshes(scene, shock);
  // The Aegis bubble and the EMP ring.
  const streakFx = createStreakFx(scene);

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

  // Gadget and killstreak visuals. Each one is created when the sim has the entity and removed when it does not.
  const smokeViews = new Map<SmokeCloud, SmokeCloudView>();
  const grenadeViews = new Map<Grenade, THREE.Mesh>();
  // Claymore models, one per mine in the sim (render/gadget-models.ts). Geometry is shared between them.
  const mineViews = new Map<Mine, ClaymoreModel>();
  const turretViews = new Map<Turret, TurretModel>();
  let droneView: DroneModel | null = null;
  let breachView: BreachMarker | null = null;

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
  let hudMode: ColourMode = paletteOf(initial.settings);
  let crosshairKey = '';
  let lastRenderedAt = -Infinity;
  // True when the last draw was a held frame of a paused or finished match (see the end of frame()).
  let heldFrame = false;

  // Per-match counters for the profile (headshots, best streak, kills by source), and the gamepad.
  const tally = new MatchTally();
  const pad = new GamepadInput();
  const keyboard = new KeyboardInput(() => state === 'play');
  keyboard.attach(window);
  const mouse = new MouseInput(() => state === 'play');
  mouse.attach(canvas, window);
  const lock = new PointerLock(canvas, document);
  lock.attach();
  let wasLocked = false;

  // The HUD. Its view is built each frame from the sim and the messages in hudState.
  const hudState = new HudState();
  const keyOf = (action: Action): string => keyLabel(liveNow.bindings.get(action));
  const hudEnv: HudEnv = {
    difficultyTickets: difficulty.tickets,
    keyOf,
    mapName: map.name,
    difficultyName: difficulty.name,
  };
  const project: WorldProjector = (x, y, z): ScreenPoint => {
    camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, y, z).project(camera);
    return {
      x: ((v.x + 1) / 2) * viewW,
      y: ((1 - v.y) / 2) * viewH,
      onScreen: v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05,
    };
  };
  const hud: Hud = createHud(hudRoot, { mapDef: map, project });
  hud.setColourMode(hudMode);
  const fpsEl = doc.createElement('div');
  fpsEl.className = 'hud-fps';
  fpsEl.hidden = !initial.settings.showFps;
  hudRoot.append(fpsEl);
  hud.showIntroHints(introKeys(hudEnv));

  const pause = (): void => {
    if (state !== 'play') return;
    state = 'paused';
    keyboard.clear();
    mouse.clear();
    fireClick = false;
    // A held pointer lock keeps the mouse on the canvas, out of reach of the pause screen. Escape releases it in a
    // real browser; this releases it for every other way of pausing (headless Chromium does not release it on Escape).
    if (doc.pointerLockElement !== null) doc.exitPointerLock();
    opts.onPause();
  };

  // Only a paused match resumes. A finished match stays on its debrief, even if the pointer locks again.
  const resume = (): void => {
    if (state !== 'paused' || contextLoss.lost) return;
    state = 'play';
    last = null;
    opts.onResume();
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

  // Asked on the Launch click, so the browser treats it as a user gesture. A refusal is explained in the feed.
  void lock.request().then((locked) => {
    if (!locked && !disposed) hudState.feed(POINTER_REFUSED_MESSAGE, 'warn');
  });

  // A lost context pauses play and shows the notice. The resume is refused until the context is back.
  const contextLoss = createContextLossHandler({
    onLost: () => {
      pause();
      hudState.feed(CONTEXT_LOST_MESSAGE, 'warn');
    },
    onRestored: () => {
      hooks.onContextRestored();
    },
  });
  contextLoss.attach(canvas);

  const onCanvasMouseDown = (event: MouseEvent): void => {
    if (state !== 'play' || event.button !== 0) return;
    fireClick = true;
    // A click in play captures the mouse when it is not captured yet.
    if (doc.pointerLockElement !== canvas) void lock.request();
  };
  canvas.addEventListener('mousedown', onCanvasMouseDown);

  // Escape pauses play. Chrome also leaves the pointer lock on Escape, which pauses through the lock change.
  const onEscapeKey = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') pause();
  };
  window.addEventListener('keydown', onEscapeKey);

  const onVisibility = (): void => {
    if (document.hidden) {
      keyboard.clear();
      mouse.clear();
      fireClick = false;
      // A hidden tab stops the frames. Pause, so the match does not run on without a player.
      pause();
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
    if (isGone() || !postWanted() || chain === null || post !== null) {
      chain?.dispose();
      if (!isGone()) setHemi(post !== null);
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
  const startPost = (): void => {
    void initPost().catch((err: unknown) => {
      console.warn('Post setup failed; running without post.', err);
      setHemi(false);
    });
  };
  startPost();

  // Applies a graphics quality: the same work for a downgrade, an upgrade, or a change on the settings screen.
  const applyQuality = (next: Quality): void => {
    if (disposed || next === quality) return;
    quality = next;
    profile = profileFor(next, window.devicePixelRatio);
    if (!profile.post) {
      post?.dispose();
      post = null;
      scene.environment = null;
    }
    renderer.setPixelRatio(profile.pixelRatioCap);
    renderer.shadowMap.enabled = profile.shadows;
    if (sun) sun.castShadow = profile.shadows;
    muzzle.visible = profile.muzzleLight;
    fx.dispose();
    fx = createFxHub(scene, profile, fxRng.fork('hub'));
    buildZones(next === 'high');
    rebuildGrass(profile.grassCount);
    // Materials recompile for the new shadow setting, as legacy does (index.html:720).
    forEachMaterial(scene, (m) => {
      m.needsUpdate = true;
    });
    setHemi(post !== null);
    if (profile.post && post === null) startPost();
    onResize();
  };

  // Auto-downgrade (legacy trackFps, index.html:2962-2977). The setting is saved by the shell, then Low is applied.
  const downgrade = (): void => {
    if (disposed) return;
    opts.patchSettings({ quality: 'low' });
    applyQuality('low');
    hudState.feed(DOWNGRADE_MESSAGE, 'warn');
  };

  // Legacy mousemove handler (index.html:3012-3016). Applied once per frame, not per fixed step.
  const applyLook = (dx: number, dy: number, s: Settings): void => {
    const sc = YAW_PER_PX * s.sens * lerp(1, s.adsMul, P.adsT);
    P.yaw -= dx * sc;
    P.pitch = clamp(P.pitch + (s.invertY ? 1 : -1) * dy * sc, -PITCH_LIMIT, PITCH_LIMIT);
  };

  const impact = (p: Vec3, dir: Vec3): void => {
    holes.add(p, dir);
    fx.impact(p, dir, classifySurface(p, mapH));
  };

  // Blood at a hostile, sprayed away from the shooter.
  const bloodAt = (e: Enemy, head: boolean): void => {
    const y = head ? 1.6 : BLOOD_Y;
    const dx = e.pos.x - P.pos.x;
    const dz = e.pos.z - P.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    fx.blood({ x: e.pos.x, y, z: e.pos.z }, { x: dx / len, y: 0, z: dz / len }, head);
    const v = enemyViews.get(e);
    if (v !== undefined) flashHuman(v.rig);
  };

  // Shake from an explosion, stronger and shorter the farther away it is.
  const blastTrauma = (at: Vec3, radius: number): void => {
    const d = Math.hypot(at.x - P.pos.x, at.z - P.pos.z);
    const k = Math.max(0, 1 - d / (radius * 5 + 10));
    if (k > 0) addTrauma(feel, 0.25 + k * 0.6);
  };

  // A floating damage number above a hostile the player hit (legacy hitNumber, index.html:3389).
  const hitNumberAt = (e: Enemy, damage: number, head: boolean, kill: boolean): void => {
    if (!liveNow.settings.damageNumbers) return;
    const p = project(e.pos.x, HIT_NUMBER_Y, e.pos.z);
    if (p.onScreen) addHitNumber(hudRoot, p.x, p.y, damage, head, kill);
  };

  // Turns the sim's events into sounds, effects, feed lines and the match end. The sim has already applied them.
  const handleEvents = (events: SimEvents): void => {
    for (const ev of events) {
      const sound = mapSimEventToSound(ev);
      if (sound !== null) opts.sound.play(sound);
      handleEvent(ev);
    }
  };

  const handleEvent = (ev: SimEvent): void => {
    switch (ev.type) {
      case 'playerFire': {
        muzzleT = MUZZLE_TIME;
        muzzleSeed = fxRng.next();
        kickViewmodel(vm);
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
        bloodAt(ev.enemy, ev.head);
        if (ev.by === 'player') {
          hudState.hit('hit');
          // The sim has already applied the hit, so a dead hostile means this was the killing blow.
          hitNumberAt(ev.enemy, ev.damage, ev.head, !ev.enemy.alive);
        }
        return;
      }
      case 'enemyKilled': {
        const label = ENEMY_DEFS[ev.enemy.kind].label;
        if (ev.by === 'player') {
          tally.kill(ev.source, ev.head);
          hudState.playerKill(label, ev.head);
          hudState.hit(ev.head ? 'head' : 'kill');
        } else {
          hudState.feed(`Squad -> ${label}`, 'kill');
        }
        return;
      }
      case 'playerHit': {
        // Legacy addDmgIndicator (index.html:1488): the marker points at the source, relative to the view.
        addDamageIndicator(
          hudRoot,
          Math.atan2(ev.from.x - P.pos.x, ev.from.z - P.pos.z) - P.yaw,
          0.4 + ev.damage / 40,
        );
        addTrauma(feel, Math.min(0.7, 0.15 + ev.damage / 80));
        return;
      }
      case 'grenadeBlast': {
        fx.explosion(ev.at, ev.radius);
        blastTrauma(ev.at, ev.radius);
        shock.add(ev.at, ev.radius);
        return;
      }
      case 'airstrikeBlast': {
        fx.explosion(ev.at, ev.radius);
        blastTrauma(ev.at, ev.radius);
        shock.add(ev.at, ev.radius);
        return;
      }
      case 'breachBlast': {
        // The sim has removed the collider. The wall's mesh goes with it.
        mapH.breakBox(ev.box);
        fx.explosion(ev.at, ev.radius);
        blastTrauma(ev.at, ev.radius);
        shock.add(ev.at, ev.radius);
        return;
      }
      case 'turretShot': {
        tracers.add(tracerSegment(ev.from, ev.to));
        return;
      }
      case 'zoneCaptured': {
        // Legacy feed line (index.html:2575).
        hudState.feed(`${ev.name} secured · -${String(ZONE_TICKET_COST)} enemy tickets`, 'good');
        return;
      }
      case 'killstreakEarned': {
        // Legacy announce (index.html:2024).
        const label = readyLabel(ev.id);
        const key = keyOf('killstreak');
        hudState.announce(`${label} earned`, `press ${key} to call it in`, 2);
        hudState.feed(`Killstreak ready: ${label} [${key}]`, 'good');
        return;
      }
      case 'killstreakUsed': {
        tally.killstreakUsed();
        if (ev.id === 'shield') streakFx.shieldFlash(P.pos);
        else if (ev.id === 'emp') streakFx.empPulse(P.pos);
        const used = KILLSTREAK_USED[ev.id];
        hudState.feed(used.feed, 'good');
        hudState.announce(used.banner, used.sub);
        return;
      }
      case 'sentryNoGround': {
        hudState.feed('No clear ground for a sentry here', 'warn');
        return;
      }
      case 'resupplied': {
        hudState.feed('Resupplied', 'good');
        return;
      }
      case 'playerDown': {
        hudState.feed('You are down. Squadmate nearby can revive you.', 'warn');
        return;
      }
      case 'playerEliminated': {
        tally.died();
        hudState.feed('You were eliminated', 'death');
        return;
      }
      case 'playerRevived': {
        // Legacy banner (index.html:1656).
        hudState.feed(`${ev.by} revived you`, 'good');
        hudState.announce('REVIVED', `by ${ev.by}`, 1.4);
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
        hudState.feed(`${ev.operator.name} is down`, 'warn');
        return;
      }
      case 'wave': {
        hudState.feed(`Wave ${String(ev.wave)} inbound`);
        return;
      }
      case 'orderChanged': {
        // Legacy banner (index.html:2993).
        hudState.announce(`Squad: ${SQUAD_ORDER_NAMES[ev.order]}`, '', 1.2);
        return;
      }
      case 'matchEnd': {
        finishMatch(ev.result);
        return;
      }
      default:
        return;
    }
  };

  // The match is over. The sim has stopped, input is released and the shell shows the debrief. Redeploy and
  // Main menu are the only ways on.
  const finishMatch = (result: MatchResult): void => {
    state = 'over';
    keyboard.clear();
    mouse.clear();
    fireClick = false;
    hud.setVisible(false);
    if (doc.pointerLockElement !== null) doc.exitPointerLock();
    opts.onOver(result, buildMatchStats(result, tally, loadout.difficulty, loadout.primary));
  };

  const simStep = (first: boolean): void => {
    const pressed: ReadonlySet<string> = first ? pendingPressed : new Set<string>();
    if (first) pendingPressed = new Set<string>();
    // The pad's stick and held buttons count as keys, and its triggers as the mouse buttons.
    const held = pad.connected
      ? new Set([...keyboard.held(), ...pad.held(liveNow.bindings)])
      : keyboard.held();
    const mouseButtons = mouse.buttons();
    const padButtons = pad.buttons();
    const cmd = buildCommand(
      held,
      { fire: mouseButtons.fire || padButtons.fire, ads: mouseButtons.ads || padButtons.ads },
      { dx: 0, dy: 0 },
      pressed,
      liveNow.bindings,
    );

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

  // Places the zone, gadget and killstreak visuals for this frame from the sim lists. A removed entity loses its
  // visual here, as syncHumans does for hostiles.
  const syncWorld = (fxDt: number): void => {
    sim.zones.forEach((z, i) => {
      const v = zoneViews[i];
      if (v !== undefined) v.update(z, liveNow.settings.colorblind);
    });
    sim.crates.forEach((c, i) => {
      mapH.setCrateVisible(i, c.cd <= 0);
    });

    const liveSmokes = new Set<SmokeCloud>(sim.smokes);
    for (const [s, v] of smokeViews) {
      if (!liveSmokes.has(s)) {
        v.dispose();
        smokeViews.delete(s);
      }
    }
    for (const s of sim.smokes) {
      let v = smokeViews.get(s);
      if (v === undefined) {
        v = smokeCloud(scene, s.pos, fxRng);
        smokeViews.set(s, v);
      }
      v.setOpacity(s.opacity);
    }

    const liveNades = new Set<Grenade>(sim.grenades);
    for (const [g, m] of grenadeViews) {
      if (!liveNades.has(g)) {
        scene.remove(m);
        grenadeViews.delete(g);
      }
    }
    for (const g of sim.grenades) {
      let m = grenadeViews.get(g);
      if (m === undefined) {
        m = grenadeMesh(grenadeViewKind(g));
        scene.add(m);
        grenadeViews.set(g, m);
      }
      m.position.set(g.pos.x, g.pos.y, g.pos.z);
    }

    const liveMines = new Set<Mine>(sim.mines);
    for (const [mn, m] of mineViews) {
      if (!liveMines.has(mn)) {
        m.dispose();
        mineViews.delete(mn);
      }
    }
    for (const mn of sim.mines) {
      let m = mineViews.get(mn);
      if (m === undefined) {
        m = claymoreModel(mn.pos.x, mn.pos.z, mn.yaw ?? 0);
        scene.add(m.group);
        mineViews.set(mn, m);
      }
      m.update(mn.armT, sim.time);
    }

    const liveTurrets = new Set<Turret>(sim.turrets);
    for (const [t, v] of turretViews) {
      if (!liveTurrets.has(t)) {
        v.dispose();
        turretViews.delete(t);
      }
    }
    for (const t of sim.turrets) {
      let v = turretViews.get(t);
      if (v === undefined) {
        v = turretModel();
        v.group.position.set(t.pos.x, 0, t.pos.z);
        scene.add(v.group);
        turretViews.set(t, v);
      }
      v.setYaw(t.yaw);
    }

    if (sim.drone !== null) {
      if (droneView === null) {
        droneView = droneModel();
        scene.add(droneView.group);
      }
      droneView.setPos(sim.drone.pos.x, sim.drone.pos.y, sim.drone.pos.z);
      droneView.spin(fxDt);
    } else if (droneView !== null) {
      droneView.dispose();
      droneView = null;
    }

    const plant = sim.breach.plant;
    if (plant !== null) {
      if (breachView === null) breachView = breachMarker(scene);
      breachView.setPosition(plant.point);
      breachView.flash(sim.time);
    } else if (breachView !== null) {
      breachView.dispose();
      breachView = null;
    }
  };

  const frame = (now: number): void => {
    raf = requestAnimationFrame(guardedFrame);
    const frameDt = last === null ? 0 : (now - last) / 1000;
    last = now;
    liveNow = opts.live();
    const s = liveNow.settings;
    // The pad is read every frame. Start pauses. Presses are only kept while the match is in play.
    pad.poll();
    if (state === 'play' && pad.takeStart()) pause();
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
      fpsEl.textContent = `${String(Math.round(fps))} FPS`;
      if (governor.sample(fps, inPlay, quality) === 'downgrade') downgrade();
    }
    if (fpsEl.hidden !== !s.showFps) fpsEl.hidden = !s.showFps;
    const crossKey = `${s.crosshair}:${s.crosshairColour}`;
    if (crossKey !== crosshairKey) {
      crosshairKey = crossKey;
      hud.setCrosshair(s.crosshair, s.crosshairColour);
    }

    // Settings changed on the settings screen take effect now.
    const mode = paletteOf(s);
    if (mode !== hudMode) {
      hudMode = mode;
      hud.setColourMode(mode);
    }
    if (s.quality !== quality) applyQuality(s.quality);
    if (Math.abs(camera.fov - (s.fov + fovDelta)) > 0.01) {
      camera.fov = s.fov + fovDelta;
      camera.updateProjectionMatrix();
    }

    // Effects and the viewmodel run on the clamped frame time, and stop while paused.
    const fxDt = inPlay ? capDt(frameDt) : 0;
    if (inPlay) {
      const mouseLook = mouse.drainLook();
      const padLook = pad.look(fxDt);
      const look = { dx: mouseLook.dx + padLook.dx, dy: mouseLook.dy + padLook.dy };
      applyLook(look.dx, look.dy, s);
      applyViewmodelLook(vm, look.dx, look.dy);
      for (const code of keyboard.drainPressed()) pendingPressed.add(code);
      for (const code of pad.drainPressed(liveNow.bindings)) pendingPressed.add(code);
      if (pad.takeFireEdge()) fireClick = true;
      const steps = step.advance(frameDt);
      for (let i = 0; i < steps; i++) simStep(i === 0);
      bobT += fxDt * bobSpeed(P.sprinting, P.moving);
      muzzleT = Math.max(0, muzzleT - fxDt);
      // Spring dt is capped at 0.05 s (see fxDt above).
      stepViewmodel(vm, fxDt, currentReload(), P.sprinting && P.moving);
    } else {
      keyboard.drainPressed();
      mouse.drainLook();
      pad.clear();
    }

    fxClock += fxDt;
    fx.update(fxDt);
    atmosphere.update(fxDt, P.pos.x, P.pos.y + P.eyeHeight, P.pos.z);
    lamps.update(fxClock);
    debris.update(fxDt);
    debrisView.sync();
    casings.update(fxDt);
    casingView.sync();
    tracers.update(fxDt);
    tracerView.sync();
    shock.update(fxDt);
    shockView.sync();
    streakFx.update(fxDt);
    holeView.sync();
    syncHumans(fxDt);
    syncWorld(fxDt);

    // Rain only on Substation at High, as legacy (index.html:3156).
    const rainOn = profile.rainOnSubstation && map.id === RAIN_MAP;
    rain.setVisible(rainOn);
    if (rainOn) rainField.update(fxDt, P.pos.x, P.pos.z);

    // The gun in hand follows the sim (legacy curW). A new gun clears the kick, as legacy switchWeapon does.
    const inHand = sim.activeSlot === 0 ? primaryModel : sidearmModel;
    if (inHand !== shown) {
      showGun(inHand);
      vm.gunKick = 0;
    }
    // The sim owns the knife timer; the viewmodel thrust follows it.
    vm.meleeT = sim.meleeT;
    const pose = gunPose(vm, {
      adsT: P.adsT,
      moving: P.moving,
      bobT,
      switchT: sim.switchT,
      reloadProgress: currentReload(),
    });
    poseGun(shown, pose);
    flashMuzzle(shown, muzzleT > 0 ? muzzleT / MUZZLE_TIME : 0, muzzleSeed);
    shown.group.visible = viewmodelVisible(P.alive, isScoped(weaponNow().def.id, P.adsT));
    muzzle.intensity = muzzleT > 0 ? MUZZLE_INTENSITY : 0;

    // Interpolate the rendered position between the last two sim states.
    const a = step.alpha;
    camera.position.set(
      lerp(prevX, P.pos.x, a),
      lerp(prevY, P.pos.y, a) + P.eyeHeight,
      lerp(prevZ, P.pos.z, a),
    );
    // Reduced motion drops the shake, the sprint FOV kick and the head bob.
    const still = s.reducedMotion;
    const off = stepCameraFeel(feel, fxDt, {
      sprinting: P.sprinting && P.moving && !still,
      moving: P.moving && !still,
      bobT,
      ads: P.adsT,
      shakeScale: s.shake && !still ? 1 : 0,
    });
    fovDelta = off.fovDelta;
    camera.position.x += off.x;
    camera.position.y += off.y;
    camera.rotation.set(P.pitch + off.pitch, P.yaw + Math.PI, off.roll, 'YXZ');
    post?.setFx({
      damage: Math.min(1, feel.trauma * 1.4),
      low: lowHealth(P.hp),
      flash: 0,
      sprint: feel.sprint * (1 - P.adsT),
      time: fxClock,
    });

    // The HUD reads the sim after the step and the camera update, so its projections match this frame.
    hudState.advance(fxDt);
    // The Tab scoreboard shows while its key is held in play (legacy index.html:2899-2900).
    const scoreboardHeld = inPlay && keyboard.held().has(liveNow.bindings.get('scoreboard'));
    hud.update(buildHudView(sim, hudEnv, hudState), fxDt, buildHudExtras(sim, hudEnv, scoreboardHeld));

    // A paused or finished match draws its last picture once and then holds it. The pause and debrief screens sit on
    // top of that picture, and software GL is slow enough to starve the page while it draws every frame.
    if (!contextLoss.lost && (inPlay || !heldFrame)) {
      if (post !== null) post.render();
      else renderer.render(scene, camera);
      heldFrame = !inPlay;
    }
  };

  // A fault in one frame must not leave a silent, frozen match. The first fault pauses play and says so. Later faults
  // are counted and not logged again, so a fault that repeats every frame cannot flood the console.
  let frameFaults = 0;
  const guardedFrame = (now: number): void => {
    // The frame rate limit skips animation frames until the interval has passed. The sim time is not affected: a
    // skipped frame's time is added to the next one.
    const cap = liveNow.settings.fpsCap;
    if (cap > 0 && now - lastRenderedAt < 1000 / cap - 1) {
      raf = requestAnimationFrame(guardedFrame);
      return;
    }
    lastRenderedAt = now;
    try {
      frame(now);
    } catch (err) {
      frameFaults += 1;
      if (frameFaults === 1) {
        console.error('Frame failed; pausing the match.', err);
        hudState.feed(FRAME_FAULT_MESSAGE, 'warn');
        pause();
      }
    }
  };

  if (opts.debug) {
    installDebugHook({
      player: () => P,
      shots: () => sim.playerShots,
      hits: () => sim.playerHits,
      state: () => state,
      forceTickets: (n) => {
        sim.forceEnemyTickets(n);
      },
    });
  }

  // The render loop starts here. The pointer lock was asked for at the Launch click (above).
  raf = requestAnimationFrame(guardedFrame);

  return {
    state: () => state,
    resume: () => {
      if (state !== 'paused' || contextLoss.lost) return;
      // The click that resumes is a user gesture, so the pointer lock is asked for here.
      void lock.request();
      resume();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      contextLoss.detach();
      keyboard.detach();
      mouse.detach();
      lock.detach();
      unsubscribeLock();
      canvas.removeEventListener('mousedown', onCanvasMouseDown);
      window.removeEventListener('keydown', onEscapeKey);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      hud.dispose();
      post?.dispose();
      post = null;
      for (const v of zoneViews) v.dispose();
      zoneViews = [];
      for (const v of smokeViews.values()) v.dispose();
      smokeViews.clear();
      for (const v of turretViews.values()) v.dispose();
      turretViews.clear();
      for (const v of mineViews.values()) v.dispose();
      mineViews.clear();
      streakFx.dispose();
      droneView?.dispose();
      droneView = null;
      breachView?.dispose();
      breachView = null;
      lamps.dispose();
      atmosphere.dispose();
      fx.dispose();
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
      // Frees the WebGL context now. Each redeploy makes a new renderer, and browsers cap live contexts.
      renderer.forceContextLoss();
      stage.replaceChildren();
    },
  };
}
