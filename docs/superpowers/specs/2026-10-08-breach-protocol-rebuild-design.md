# Breach Protocol Rebuild: Design Spec

**Status:** Proposal, awaiting sign-off on the stack (§2), phase order (§8) and open decisions (§9).
**Source of truth:** `index.html` on `main` of `TharrosDev/breach-protocol` (156,899 bytes, 3,474 lines). The local copy is byte-identical to it.
**Companion:** [implementation plan](../plans/2026-10-08-breach-protocol-rebuild.md).

The current file is treated as a spec. Its numbers are the parity oracle; its structure is not kept.

---

## 1. Feature inventory and parity contract

Everything below must work after the rebuild. Numbers are copied from the current file and become test expectations.

### 1.1 Match and objectives
- Two maps. **Compound**: fog 55–150, zones ALPHA (-29,-28), BRAVO (29,-28), CHARLIE (1,22); breachable walls; 55 crates, 14 barrels, 8 sandbags. **Substation**: fog 65–170, zones CONTROL (0,-20), GENERATOR (0,30), TRANSFORMER (-37,31); night sky with stars and rain (High only); 40 crates, 12 barrels, 6 sandbags.
- Zone radius 4.2 m. Capture takes 7 s with only friendlies inside. Contested zones decay at 0.6× the capture rate. Capturing a zone costs the enemy 35 tickets. A player inside at capture earns +250.
- Enemy tickets: each hostile killed costs 1. Win when tickets reach 0 or every zone is captured.
- Lose when the player dies with no reinforcements left.
- Difficulty (hp × / dmg × / reinforcements / max hostiles / wave timer / tickets):

| Level | HP | Dmg | Lives | Max hostiles | Wave timer | Tickets |
|---|---|---|---|---|---|---|
| Recruit | 0.7 | 0.6 | 5 | 14 | 16 | 100 |
| Veteran | 1.0 | 1.0 | 3 | 22 | 14 | 150 |
| Elite | 1.35 | 1.35 | 2 | 30 | 11 | 200 |

- Waves: count `min(2 + floor(wave/2), 6)`. Wave timer `max(6, base - 0.7·wave)`. Type by wave: grenadier (wave ≥ 4, roll < 0.18), sniper (wave ≥ 2, roll < 0.30), heavy (wave ≥ 3, roll < 0.50), otherwise rifle. Spawns on a ring of radius 50–55 m.
- Four guards per zone at spawn, guard sight capped at 26 m.

### 1.2 Player movement
- Walk 4.9 m/s, crouch 2.3, sprint 7.4 (8.6 with Lightweight). Sprint needs forward input, not crouched, not aiming, not firing, stamina > 0.02, grounded. A 0.35 s cooldown follows a sprint.
- Ground control rate 10, air control rate 3.5. Gravity 22. Jump velocity 7.2. Coyote time 0.12 s. Jump buffer 0.12 s.
- Slide: starts from crouch while sprinting if speed ≥ 4. Lasts 0.85 s. Speed `max(speed, 8.5)` decaying linearly. Eye height 0.6 while sliding, 0.95 crouched, 1.65 standing. Camera rolls 0.09 rad.
- Vault: jumping at a low obstacle (top 0.5–1.35 m, not breakable) within 1.1 m lands on the first free spot up to 3 m past it, over 0.35 s.
- Stamina drains 0.22/s sprinting (×0.6 with Lightweight), regenerates 0.16/s.
- Passive health regen 25 hp/s after 4 s without damage. Health max 100.
- Player radius 0.35. Walls 4.2 m high, props up to 2.5 m get soft contact shadows.
- Camera: FOV 75 default (60–110). ADS FOV per weapon (VX 55, K-Vector 60, Breaker 60, Hammer 55, Warden 35, Pistol 60). Sprint adds +4° FOV. Head bob 0.035 m (ADS ×0.3). ADS speed 17 with Reflex, 12 without. ADS slows movement ×0.6.

### 1.3 Weapons, ballistics, attachments, perks
Weapons (dmg / headshot ×/ rpm / mag / reserve / reload s / spread / spread max / spread gain / recoil / range m / auto):
- VX-9 Rifle: 24 / 2.5 / 690 / 30 / 150 / 2.1 / 0.010 / 0.045 / 0.005 / 0.008 / 200 / auto
- K-Vector SMG: 17 / 2.2 / 900 / 36 / 216 / 1.8 / 0.018 / 0.060 / 0.003 / 0.005 / 90 / auto
- Breaker Shotgun: 11 / 1.0 / 70 / 6 / 36 / 2.6 / 0.050 / 0.070 / 0 / 0.050 / 45 / semi, 9 pellets
- Hammer LMG: 20 / 2.0 / 480 / 80 / 240 / 4.2 / 0.012 / 0.050 / 0.002 / 0.006 / 150 / auto
- Warden DMR: 52 / 2.5 / 240 / 10 / 60 / 2.6 / 0.004 / 0.020 / 0.010 / 0.035 / 250 / semi, scoped
- Viper Pistol (sidearm): 30 / 2.3 / 260 / 12 / 60 / 1.3 / 0.012 / 0.030 / 0.008 / 0.030 / 120 / semi

- Damage falls off past half the range, linear to 70% at max range. Heavies take ×0.6 on non-head hits.
- Per shot: spread = base × (ADS ×0.55 when aiming) × attachment × (moving ×1.35) × (sprinting ×2). Recoil adds pitch; yaw jitter is random. Spread recovers at 0.5/s when not firing.
- Attachments (one): None; Suppressor (quiet, enemies hear you only within 8 m); Extended mag (×1.5 rounded); Vertical grip (recoil ×0.7); Reflex optic (spread ×0.85, faster ADS).
- Perks (one): Steady Aim (recoil ×0.7, spread recovers 2×); Fast Hands (reload ×0.7); Lightweight (see §1.2); Ghost (enemies detect at 0.7× range).
- Reload: restores `min(missing, reserve)`. Switching weapons cancels it. Weapon switch takes 0.35 s.
- Two loadout gadget slots, pick 2 of 5: Frag (2, blast), Flashbang (2, blinds hostiles in LOS within 18 m for 3.5 s; blinds the player for 3 s), Smoke (2, radius 3.6 m for 9 s, blocks LOS and fire), Medkit (2, +50 hp), Recon Drone (1, 10 s, flies 9 m/s, spots hostiles within 22 m).
- Melee knife (Q): 1.7 m cone, cooldown 0.9 s, 0.3 s animation; 150 damage from behind, 80 from the front.

### 1.4 Killstreaks and breach
- Streak rewards at 3 / 5 / 7 consecutive kills, used with H: UAV (20 s, reveals hostiles); Sentry turret (45 s, 12 dmg per shot, range 40 m, fires every 0.12 s, placed on clear ground 2–8 m ahead); Airstrike (5 blasts radius 5 m across a 12 m box, 300 ms + k·260 ms, 130 dmg falloff, 70 to the player).
- Breach charge (E, on a reinforced wall): 2 per life, arms in 2.2 s, radius 4.5 m, 110 to hostiles and 60 to the player at the centre, falloff linear.
- Crates: E resupplies ammo, gadgets, charges, hp and stamina. 30 s cooldown per crate.
- Score: kill 100 (+50 headshot), revive +150, zone capture +250 for the player present.

### 1.5 Hostiles and squad
- Enemies (hp / dmg / fire interval s / accuracy / speed / sight m):
  - Rifleman: 60 / 8 / 0.45 / 0.05 / 3.1 / 50
  - Heavy (shield, slow): 150 / 13 / 0.75 / 0.035 / 2.0 / 45
  - Sniper: 55 / 40 / 2.4 / 0.012 / 2.4 / 110. Holds a 28–40 m band.
  - Grenadier: 70 / 10 / 0.7 / 0.06 / 2.8 / 40. Throws frags at 5–24 m every 9–12 s.
- Roles: 35% of non-guards flank (wide approach at 9 m). Others push. Under 45% hp, enemies seek cover (12 samples, 3–8 m away, out of sight).
- Intel: the first enemy to spot the player alerts hostiles within 18 m. Hostiles keep 0.9 m separation.
- Operators: 2 AI allies, 100 hp, 14 dmg (28 headshot), 0.14–0.19 s fire interval. Squad order cycles with V: Attack (engage within 55 m, take zones), Hold (fire, no move), Follow (stay within 4 m; engage within 40 m).
- Downed player: nearby operator (within 18 m) revives after 2.5 s within 2.2 m. Bleedout 12 s. Otherwise eliminated and respawn after 4 s on a squadmate if clear, else at the spawn farthest from hostiles. Dead operators respawn after 20 s.

### 1.6 Settings, bindings, persistence
- Settings tabs. **Controls**: 17 rebindable actions (move ×4, jump, crouch, sprint, reload, weapon 1/2, gadget 1/2, interact, melee, order, killstreak, scoreboard). Click, press a key, Esc cancels. Taking a key in use swaps the two. Reset defaults. **Mouse**: sensitivity 0.1–3, ADS multiplier 0.2–1.2, DPI (400/800/1600/3200) for a cm-per-360 calculator, invert Y. **Display**: FOV, quality High/Low, FPS counter, screen shake, colour-blind zone colours. **Audio**: master volume 0–1.
- Mouse look: `YAW_PER_PX` 0.0022, scaled by sensitivity and lerped to the ADS multiplier by ADS progress.
- Storage keys (must keep reading these): `bp_settings`, `bp_loadout`, `bp_binds`, `bp_intro` (one-time control hints). Storage blocked → game works, settings don't persist.
- Auto-downgrade: in play, FPS below 38 for 5 s sets quality to Low and shows a feed message.
- Debug hook: `?debug` exposes internals to tests. Keep it behind the flag.

### 1.7 Visuals and audio
- Renderer: ACES filmic tone mapping, exposure 1.05, PCF soft shadows, 2048 sun shadow map. Hemisphere light and directional sun per map.
- High quality only: UnrealBloom (strength 0.22, radius 0.5, threshold 0.92), RoomEnvironment reflections via PMREM, 900 grass tufts (Low: 260), 6 street lamps with glow sprites, rain on Substation (600 streaks).
- Always on: gradient sky dome, bullet holes (max 80), casings (max 24), debris (max 90), particle pool (500), explosion shockwave, muzzle flash sprite and point light, tracers, blood/hit feedback, hit markers, damage direction indicators, whiteout and vignette on hurt.
- Viewmodel: weapon spring (stiffness 180, damping 22) follows look input with clamps ±0.09 x / ±0.07 y, decaying. Reload dip and magazine drop. Melee thrust. Scope overlay for the DMR (ADS > 0.9).
- HUD: top compass strip with zone markers, three zone capture bars, enemy ticket bar. Top-left score, hostiles, reinforcements, operators, squad order. Top-right minimap (180 px) and feed. Bottom-left health and stamina. Bottom-right weapon, ammo, gadget slots, breach count, killstreak progress. Spotted-hostile boxes, zone world markers, squad cards, floating hit numbers, prompts, intro hints. Crosshair gap widens with spread.
- Procedural Web Audio only: noise and tone synthesis for gunfire, explosions, pickups and hits. Master gain from settings.

### 1.8 Known defects to fix, not preserve
- `Math.random` everywhere and frame-rate-dependent updates. Gameplay can't be replayed or tested deterministically.
- Menus can't be fully used from the keyboard. Screen changes don't move focus. Esc doesn't go back consistently.
- Uppercase, letter-spaced labels at 12 px in the HUD and menus. Some are body-length text.
- Colour-blind mode covers zone colours only. HUD health, hostile markers and hit markers still rely on red and green.
- Pointer lock refusal is silent. Play continues without capture and nothing explains it.
- WebGL loss is not handled. A context loss leaves a dead canvas.
- Debug hook has a meaningless `enemyWalkable` getter and an odd `clearFn` getter.
- `P.shots` and `P.hits` exist only after the first match starts.
- Global `error` listener writes exceptions into the kill feed.

---

## 2. Target stack

| Concern | Choice | Why |
|---|---|---|
| Language and build | TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vite, ES modules, Node 22 LTS, npm | Matches the request. npm avoids a second package manager in CI and on Vercel. |
| Renderer | `three` from npm, **pinned to 0.160.0** through the parity phase. Upgrade is a separate, later task. Post-processing from `three/examples/jsm` (EffectComposer, UnrealBloomPass, OutputPass, RoomEnvironment) | Keeps the lighting and tone mapping the current look depends on. Upgrading three changes both. No CDN at runtime. |
| Simulation | Fixed 60 Hz step with an accumulator and render interpolation. Seeded PRNG (sfc32) for all gameplay randomness. No `Math.random` in `sim/` (lint rule). | Deterministic enough for replays, tests and later netcode. Frame rate can't change outcomes. |
| Entities | Small hand-written ECS: integer entity IDs, typed component stores, ordered systems | Components can be diffed and snapshotted for netcode. Avoids a class hierarchy for 40+ hostile and operator behaviours. |
| Collision and navigation | Axis-aligned boxes as today. Grid A* (120×120 cells, 1 m, 8-way, corner-cutting blocked) instead of a navmesh | Every map is a set of boxes. The current grid works and is cheap to validate. A navmesh buys nothing here. |
| AI | Explicit state machines per role (Guard, Hunt, Engage, TakeCover, Flank, Retreat, Revive). Utility scores pick targets and cover. | Keeps the current behaviour readable and testable. A behaviour tree is more machinery than this needs. |
| HUD and menus | Retained DOM with a small binding layer. Shared focus manager for menus. No framework. | The HUD is about 40 elements updated per frame. A framework adds weight and reconciliation for no gain. |
| Audio | Web Audio graph with buses (master → sfx, ui, ambience) and a compressor limiter. SFX stay procedural (no assets). | The sounds are synthesized now. Assets are added only where synthesis doesn't sound right. |
| Maps and content | TypeScript modules typed as `MapDef`, `WeaponDef`, `EnemyDef`, plus `tuning.ts` holding every constant from §1 | Type checking catches broken references. A validator test checks map invariants (§5). |
| Persistence | Versioned schema on the existing localStorage keys. Validation falls back per field to defaults. | Existing players keep their settings and bindings. Bad data can't crash start-up. |
| Testing | Vitest for `sim/`, `content/`, `persist/`, `input/`. Playwright for E2E and visual regression, projects: Chromium, Edge (channel `msedge`), Firefox. axe-core for accessibility. | Pure simulation tests run without a browser. E2E covers what a browser must do. |
| Lint and format | ESLint flat config with typescript-eslint, `import/no-cycle`, and a boundary rule (`sim/` cannot import `render/`, `ui/`, `audio/` or the DOM). Prettier. | Enforces the layer split in §3. |
| CI | GitHub Actions: lint, typecheck, unit, build, E2E matrix. Playwright traces and screenshots uploaded on failure. | Required before merge. |
| Hosting | Vercel Git integration (already linked to `main`). Preview per branch and PR. Production only from `main`. Legacy build kept at `/legacy/`. | Rollback is one redeploy of the legacy file. |
| Backend (phase 8) | Vercel Functions in `api/` (TypeScript). Postgres from the Vercel Marketplace (Neon). Anonymous player IDs (random UUID, stored locally). Server-issued match token. | Serverless fits the traffic. Anonymous IDs need no sign-in. |

**Rejected:** Phaser or Babylon (rewrite the renderer with no feel gain); React or Svelte for HUD (overhead); WebGPU (not in the browser matrix); JSON map files (lose type checking; validator covers the same ground).

**Upgrade later, not now:** three.js past 0.160 and Vite major versions. Each is its own task with a parity run.

---

## 3. Architecture

```
src/
  core/        fixed-step clock, seeded RNG, ECS, math, event bus       (no DOM)
  sim/         world, systems: movement, collision, weapons, ballistics,
               ai/, nav/, squad, waves, objectives, tickets, killstreaks,
               gadgets, breach, scoring, match state machine            (no DOM, no three.js)
  content/     tuning.ts, weapons, enemies, attachments, perks, gadgets,
               killstreaks, difficulty, maps/*.ts                       (data only)
  input/       bindings, keyboard/mouse adapters, pointer lock          (DOM allowed)
  render/      renderer, scene, map builder, viewmodel, fx, particles,
               post, quality tiers, minimap canvas                      (three.js)
  ui/          HUD bindings, screens (menu, brief, loadout, settings,
               pause, debrief), focus manager, colour tokens            (DOM)
  audio/       graph, buses, synth recipes                              (Web Audio)
  persist/     versioned storage, migrations                            (localStorage)
  app/         composition root: wires the above; capability checks; ?debug hook
  net/         phase 8 client only
api/           phase 8 Vercel functions
tests/unit     Vitest, mirrors src/
tests/e2e      Playwright specs and screenshot baselines
```

- `sim/` is a pure function of `(state, input, dt, rng)`. Rendering reads a snapshot. This is what makes replay and netcode possible later.
- Input becomes a per-tick command record (`{ move, look, buttons, ... }`). The sim never reads the keyboard.
- The HUD reads a read-only view of the sim each frame. It never writes game state.

---

## 4. Quality bar and how it is verified

| Requirement | Verification | Honest limit |
|---|---|---|
| No regressions | Parity table (`docs/parity.md`) maps each §1 item to a test. A script fails CI if a row has no test file. | Parity of feel is judged by a person playing both builds side by side. Automated tests check numbers, not feel. |
| ≥ 60 fps on mid-range hardware at High | Scripted 60 s benchmark on Compound with a seeded squad. Frame-time p95 recorded in each phase's PR. | Headless CI renders with SwiftShader, which is not representative. Real numbers need real hardware, so the reference machine is an open decision (§9). |
| Low is a real fallback | Benchmark at Low, same scenario. Low has no bloom, reflections, shadows, lamps or rain. | Same as above. |
| Auto-downgrade kept | Unit test on the FPS governor: 5 s below 38 fps triggers Low once. | None. |
| Accessibility: keyboard-complete menus | Playwright keyboard-only path through every screen. axe-core on every screen. | Screen reader behaviour is spot-checked by hand, not automated. |
| Colour-blind palette | Every hostile, zone, health and hit colour comes from a token with a colour-blind variant. Test asserts all tokens exist in both modes. | Visual check by a person with a CVD simulation filter. |
| Text ≥ 12 px, no all-caps body, no wide tracking on body | Playwright computed-style test over every text node on each screen. Fails on violations. | Labels in the HUD may use uppercase only if they are three words or fewer. |
| Chrome, Edge, Firefox | Playwright projects for all three on every PR. | Safari is out of scope. |
| WebGL fallback | WebGL2 check at boot. Without it, a message screen with a retry link. Context loss shows a recovery notice and restores. | Context loss is hard to reproduce. Unit test on the handler, plus one manual check. |
| Pointer lock fallback | On refusal or unexpected exit, pause with "Click to resume" and clear held inputs. | None. |
| Keyboard and mouse only | Touch is not supported and is not tested. | Stated, not hidden. |

**Bundle:** the budget is set from measured sizes at the end of phase 2. It is not guessed here.

---

## 5. Test strategy

- **Golden values from the current file.** Each number in §1 that a test depends on gets an assertion with a comment naming the legacy line. Examples: falloff at 0, half and max range; `60 / 690` seconds between shots; reload math; ticket and capture math; wave composition for seed 1 over waves 1–8.
- **Map invariants (validator, run for both maps):**
  - every spawn can reach every zone on the nav grid;
  - no spawn is inside a collider;
  - no prop lies within 9 m of a zone centre;
  - breachable walls are on building faces only;
  - door gaps are passable.
- **Sim tests** run headless in Vitest. A scenario builds a world with a fixed seed, steps it N ticks, and checks outcomes.
- **E2E** drives the built app with Playwright. The `?debug` hook provides seams: set tickets, set lives, place the player, read state. Scenarios: boot, deploy, fire, objective capture, win, lose, settings persistence, bindings persistence, no console errors, keyboard-only navigation.
- **Visual regression:** menus, brief, loadout, settings tabs, pause, debrief and HUD at 1280×720 and 390×844. The 3D canvas is masked or replaced with a solid colour, so only DOM is compared.
- **Review Focus cases** (the five input classes most likely to break for a real player). The plan adds one test for each to the owning task.

---

## 6. Non-goals for this rebuild

- Multiplayer netcode. The sim is prepared for it (§3). Networking is designed, not built.
- Accounts or sign-in. Anonymous IDs only (phase 8).
- New weapons, maps, or modes beyond parity. Adding content is a later decision.
- Touch controls, gamepad, or mobile layouts.
- WebGPU, three.js upgrades past 0.160, Vite major upgrades.

---

## 7. Assumptions

- The GitHub repo `TharrosDev/breach-protocol` is private with one branch (`main`) and no open PRs. The local folder has no `.git` directory, but its `index.html` matches `main` byte-for-byte.
- The live site (`breach-protocol-five.vercel.app`) responded 200 at the time of writing.
- Game feel is judged by a person. The agent verifies the numbers and flows.

---

## 8. Phase order

| Phase | Deliverable | Playable build means |
|---|---|---|
| **P0 Foundation** | Toolchain, CI, Vitest and Playwright harness, legacy preserved at `/legacy/`, parity table skeleton, preview deploy | App boots to a menu with WebGL2 check and the legacy game reachable |
| **P1 Simulation core** | Fixed step, seeded RNG, movement, collision, ballistics, weapons, bindings, persistence, input, minimal renderer | Move, slide, jump, vault, and shoot dummy targets on a boxed Compound |
| **P2 Rendering and maps** | Both maps as data, map builder, post-processing, grass, lamps, rain, debris, viewmodel springs, quality tiers and auto-downgrade | Both maps render with the current look at High and Low |
| **P3 AI, squad, waves** | Hostile state machines, perception, cover, flank, sniper band, grenadiers, operators and orders, revives, waves | Full hostile waves fight back; operators take and hold zones |
| **P4 Match rules** | Objectives, capture and decay, tickets, win/lose, killstreaks, gadgets, breach charges, scoring, match state machine | A full match can be won and lost |
| **P5 Shell and HUD** | Menus, brief, loadout, settings, pause, debrief, HUD bindings, focus manager, colour tokens, text rules | Every screen is reachable and usable from the keyboard |
| **P6 Audio** | Buses, limiter, mute, volume, first-gesture context, procedural SFX parity | Full mix audible; volume and mute persist |
| **P7 Quality gate and cutover** | Benchmark on reference hardware, browser matrix, accessibility pass, bundle budget, PR `rebuild` → `main` | Production serves the new build; legacy stays at `/legacy/` |
| **P8 Backend** | Vercel Functions, Postgres, anonymous IDs, match token, leaderboard, offline queue | Leaderboards work; game still fully playable offline |

**Why this order:** the simulation comes first so every later system has tests to run against. Rendering follows, so each phase has something to look at. AI needs weapons and ballistics. Rules need AI. Shell and HUD need the state they show. Audio is independent but needs the match events. The cutover waits until parity is proven. The backend is last because it adds risk and no gameplay requirement.

**Parallel workstreams within a phase** (disjoint file ownership): engine/sim; rendering and assets; AI; UI/HUD/menus; audio; test harness and CI; content and balance. Shared files (`app/`, `content/tuning.ts`) change only in a dedicated integration task.

---

## 9. Open decisions (need sign-off)

1. **Stack and phase order (§2, §8)** as proposed, or changes?
2. **Git setup.** The local folder isn't a repo. Plan: `git init` in place, add `origin`, fetch, and reset the index to `origin/main` without touching files. Create an integration branch `rebuild` from `main`. Each phase is a feature branch PR into `rebuild`. `main` stays untouched until the phase 7 cutover, which needs your explicit go-ahead.
3. **Reference hardware for the 60 fps target.** Which machine (model, GPU, resolution) should count as mid-range?
4. **Backend provisioning (phase 8).** Creating a Neon database through the Vercel Marketplace may incur cost. Approve before phase 8, or skip the backend?
5. **Cutover timing.** Cut over after P7, or ship the rebuild to `/next/` first and switch later?
6. **Content scope.** Parity only (plan default), or add one new map or weapon during P4?
