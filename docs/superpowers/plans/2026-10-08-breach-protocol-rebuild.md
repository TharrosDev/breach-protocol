# Breach Protocol Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the single-file Breach Protocol game as a typed, tested, deterministic-simulation TypeScript app with Vite and Three.js, keeping every current feature and feel, then cut production over to it.

**Architecture:** A fixed-step simulation in `src/sim/` with no DOM or three.js imports, a Three.js renderer in `src/render/`, a retained-DOM UI in `src/ui/`, and a Web Audio graph in `src/audio/`, wired together in `src/app/`. Content is typed TypeScript data. Backend is Vercel Functions plus Postgres, added last.

**Tech Stack:** TypeScript (strict), Vite, Three.js 0.160.0 (pinned), Vitest, Playwright (Chromium, Edge, Firefox), axe-core, ESLint (flat) with typescript-eslint, Prettier, GitHub Actions, Vercel. Node 22 LTS, npm.

**Spec:** [2026-10-08-breach-protocol-rebuild-design.md](../specs/2026-10-08-breach-protocol-rebuild-design.md). The spec holds the full parity numbers (§1), stack rationale (§2), architecture (§3), quality bar (§4) and open decisions (§9). This plan argues from it.

**Status:** Draft for sign-off. Phase 0 and 1 are bite-sized. Phases 2–8 are outlined; each gets its own bite-sized plan when it starts, after the previous phase's gate passes.

## Global Constraints

- Target stack: TypeScript, Vite, ES modules, Three.js as an npm dependency, no CDN at runtime.
- Performance: ≥ 60 fps on mid-range hardware at High. Low is a real fallback. Auto-downgrade stays: FPS below 38 for 5 s in play sets Low once.
- Text ≥ 12 px. No all-caps body text. No wide letter-spacing on body text.
- Chrome, Edge and Firefox. WebGL2 message when missing. Pointer lock fallback.
- Keyboard-complete menus. Colour-blind palette option.
- Keep `bp_settings`, `bp_loadout`, `bp_binds`, `bp_intro` localStorage keys readable. Existing players keep their settings.
- Keep `?debug` behind the flag. The hook is typed and read-only except for documented test seams.
- Commit with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Feature branches and PRs only. Never push `main` without asking.
- No secrets in the repo. Vercel environment variables for anything needing keys.
- Every number a test depends on cites its legacy line in `index.html` in a comment.

## Review Focus

1. **Corrupt or hand-edited localStorage** (wrong types, unknown action or weapon IDs, duplicate bindings). Expected: bad fields fall back to defaults, the game starts, nothing throws. Test in Task 1.7.
2. **Storage blocked** (private window, site data disabled). Expected: the game plays, settings just don't persist. Test in Task 1.7.
3. **WebGL2 unavailable or context lost.** Expected: a clear message with retry, not a blank canvas. Context loss shows a recovery notice and resumes on restore. Boot test in Task 0.3; handler test in Task 2.x.
4. **Pointer lock refused or exited mid-match.** Expected: pause with "Click to resume", held keys and fire cleared, no stuck input. Test in Task 1.8.
5. **Narrow or zoomed viewport** (390 px wide, 200% zoom at 1280 px). Expected: no horizontal scroll on menus, HUD panels don't overlap. Test in Phase 5 (the owning task for layout) and a boot check at 390 px in Task 0.3.

---

## Phase 0: Foundation

Work happens on branch `rebuild/p0-foundation`, PR into `rebuild`. `main` is not touched.

### Task 0.1: Git setup and legacy preservation

**Files:**
- Modify: `breach-protocol/` (adds `.git`; no file content changes)
- Move: `index.html` → `public/legacy/index.html`

**Interfaces:**
- Consumes: none
- Produces: branch `rebuild` (from `origin/main`); `public/legacy/index.html` byte-identical to the current `index.html`

- [ ] **Step 1: Record the current file hash**

Run: `sha256sum index.html` (in `breach-protocol/`)
Expected: a hash; save it for step 4.

- [ ] **Step 2: Initialise git and align with `origin/main` without changing files**

Run:
```bash
git init
git remote add origin https://github.com/TharrosDev/breach-protocol.git
git fetch origin
git reset --mixed origin/main
git status
```
Expected: `git status` lists only untracked `.gitignore`-excluded items or nothing; `index.html` is not reported modified.

- [ ] **Step 3: Create the integration branch and the phase branch**

Run:
```bash
git checkout -b rebuild
git checkout -b rebuild/p0-foundation
```

- [ ] **Step 4: Move the legacy file and verify**

Run:
```bash
mkdir -p public/legacy && git mv index.html public/legacy/index.html
sha256sum public/legacy/index.html
```
Expected: the hash matches step 1.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: move legacy game to public/legacy" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

### Task 0.2: Toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.nvmrc`, `index.html` (new app shell), `src/main.ts`
- Modify: `.gitignore` (add `dist/`, `playwright-report/`, `test-results/`, `coverage/`)

**Interfaces:**
- Consumes: none
- Produces: npm scripts `dev`, `build`, `preview`, `typecheck`, `lint`, `format`, `test` (Vitest), `test:e2e` (Playwright)

- [ ] **Step 1: Write the failing check**

Run: `npm run typecheck`
Expected: FAIL (`Missing script: "typecheck"`).

- [ ] **Step 2: Add the toolchain**

Install: `npm i three@0.160.0` and `npm i -D typescript vite vitest @playwright/test eslint typescript-eslint @eslint/js prettier @types/three@0.160.0`.
Set `tsconfig` to `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `moduleResolution: bundler`, `noEmit`. Set `.nvmrc` to `22`.
Scripts: `typecheck` → `tsc --noEmit`; `lint` → `eslint .`; `format` → `prettier --check .`.
The new `index.html` loads `/src/main.ts` and sets `<title>Breach Protocol</title>`.

- [ ] **Step 3: Run the checks**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all three PASS. `dist/` contains `index.html` and `legacy/index.html`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "build: add Vite, TypeScript strict, ESLint and Prettier" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

### Task 0.3: App shell, capability check, boot test

**Files:**
- Create: `src/app/capabilities.ts`, `src/app/boot.ts`, `src/main.ts` (replace the stub), `tests/unit/capabilities.test.ts`, `tests/e2e/boot.spec.ts`, `playwright.config.ts`, `vitest.config.ts`

**Interfaces:**
- Consumes: none
- Produces: `detectCapabilities(doc?: Document): { webgl2: boolean }`; `boot(root: HTMLElement): void` (shows the WebGL message screen when `webgl2` is false, otherwise the menu placeholder)

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/unit/capabilities.test.ts
import { describe, it, expect } from 'vitest';
import { detectCapabilities } from '../../src/app/capabilities';

const fakeDoc = (ctx: unknown) => ({
  createElement: () => ({ getContext: (type: string) => (type === 'webgl2' ? ctx : null) }),
}) as unknown as Document;

describe('detectCapabilities', () => {
  it('reports webgl2 false when getContext returns null', () => {
    expect(detectCapabilities(fakeDoc(null)).webgl2).toBe(false);
  });
  it('reports webgl2 true when a context is returned', () => {
    expect(detectCapabilities(fakeDoc({})).webgl2).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/capabilities.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `detectCapabilities` and `boot`**

`detectCapabilities` creates a canvas with `doc.createElement('canvas')` and calls `getContext('webgl2')`. Returns `{ webgl2: ctx !== null }`. `boot` renders a "WebGL 2 is required" panel with a Retry button (`location.reload()`) when `webgl2` is false. The message uses sentence case, 16 px, no uppercase.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run tests/unit/capabilities.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing E2E boot test**

```ts
// tests/e2e/boot.spec.ts
import { test, expect } from '@playwright/test';

test('app boots with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveTitle('Breach Protocol');
  await expect(page.getByRole('heading', { name: 'Breach Protocol' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('no horizontal scroll at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx playwright test tests/e2e/boot.spec.ts --project=chromium`
Expected: FAIL (heading missing) until the shell renders.

- [ ] **Step 7: Make it pass**

Render the menu placeholder: `<h1>Breach Protocol</h1>` plus a "Deploy" button (disabled, text "Coming in phase 1"). Configure `playwright.config.ts` with `webServer: { command: 'npm run build && npm run preview -- --port 4173', port: 4173 }`, projects chromium, firefox, and `msedge` (channel `msedge`).

Run: `npx playwright test tests/e2e/boot.spec.ts --project=chromium`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: app shell with WebGL2 check and boot E2E" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

### Task 0.4: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: npm scripts from Task 0.2; Playwright config from Task 0.3
- Produces: required status checks `lint`, `typecheck`, `unit`, `build`, `e2e (chromium|firefox|msedge)`

- [ ] **Step 1: Write the workflow**

Jobs run on `ubuntu-latest` with Node from `.nvmrc`, `npm ci`, then the matching script. E2E is a matrix over the three browsers, running `npx playwright install --with-deps <browser>` first. On failure, upload `playwright-report/` and `test-results/` as artifacts.

- [ ] **Step 2: Validate the YAML**

Run: `npx --yes actionlint` (or `gh workflow view` after the first push).
Expected: no errors.

- [ ] **Step 3: Commit, push the phase branch, watch CI**

```bash
git add -A
git commit -m "ci: lint, typecheck, unit, build and E2E matrix" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
git push -u origin rebuild/p0-foundation
```
Expected: the workflow runs on the PR once it is opened. Read the result with `gh run list`; do not poll.

### Task 0.5: Parity table skeleton and check script

**Files:**
- Create: `docs/parity.md`, `scripts/check-parity.ts`, `tests/unit/parity-check.test.ts`

**Interfaces:**
- Consumes: spec §1 section list
- Produces: `docs/parity.md` with one row per §1 item: `| ID | Feature | Spec § | Test file |`. `scripts/check-parity.ts` exports `missingTests(rows): string[]`, listing rows whose test file does not exist.

- [ ] **Step 1: Write the failing test**

Test `missingTests` with two fake rows, one pointing at an existing file and one at a missing file. Expected: returns exactly the missing one.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/parity-check.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the check and the table**

Parse the markdown table, check file existence with `fs.existsSync`. Fill `docs/parity.md` with the §1 items (IDs like `MATCH-01`, `MOVE-01`, `WPN-01`). Test-file cells may point at files that don't exist yet; the check is wired into CI as a report in P0 and becomes a hard gate at P7.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/parity-check.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: parity table and coverage check" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

### Task 0.6: Preview deploy and verification

**Files:** none (Vercel and verification)

**Interfaces:**
- Consumes: branch `rebuild/p0-foundation` pushed; Vercel project `breach-protocol` linked to GitHub
- Produces: preview URL serving the new shell at `/` and the legacy game at `/legacy/`

- [ ] **Step 1: Confirm the Vercel project is Git-linked and builds previews**

Check the project's Git connection with the Vercel MCP (`get_project`). Expected: linked to `TharrosDev/breach-protocol`, production branch `main`. If not linked, stop and report.

- [ ] **Step 2: Open the PR and wait for the preview**

Open PR `rebuild/p0-foundation` → `rebuild`. Expected: a preview deployment exists. Get its URL from the PR checks.

- [ ] **Step 3: Verify in the browser**

Open the preview in the built-in browser. Check: the shell renders with no console errors; `/legacy/` loads the game and reaches the menu. Take screenshots of both.

- [ ] **Step 4: Confirm production is untouched**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://breach-protocol-five.vercel.app/`
Expected: `200`, and the body still contains the legacy title. Production is served from `main`, which has not changed.

---

## Phase 1: Simulation core

Branch `rebuild/p1-sim`, PR into `rebuild`. Playable checkpoint: move, slide, jump, vault and shoot dummy targets on a boxed Compound.

### Task 1.1: Fixed-step clock

**Files:**
- Create: `src/core/clock.ts`, `tests/unit/clock.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `class FixedStep { constructor(hz = 60, maxFrame = 0.25); advance(frameDt: number): number; readonly dt: number; alpha: number }`. `advance` returns steps to run; `alpha` is the leftover fraction for render interpolation.

- [ ] **Step 1: Write failing tests**
  - a 1/60 s frame returns 1 step;
  - two 1/120 s frames return 0 then 1;
  - a 1 s frame is clamped to 0.25 s and returns 15 steps;
  - `alpha` stays in [0, 1).

- [ ] **Step 2: Run to verify they fail**
Run: `npx vitest run tests/unit/clock.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** an accumulator. `dt` is `1 / hz`.

- [ ] **Step 4: Run to verify they pass**. Expected: PASS.

- [ ] **Step 5: Commit** `feat(core): fixed-step clock`.

### Task 1.2: Seeded RNG and no-random lint rule

**Files:**
- Create: `src/core/rng.ts`, `tests/unit/rng.test.ts`
- Modify: `eslint.config.js` (ban `Math.random` under `src/sim/**`, `src/content/**`)

**Interfaces:**
- Consumes: none
- Produces: `createRng(seed: number): Rng` with `next(): number` in [0, 1), `range(a: number, b: number): number`, `pick<T>(items: readonly T[]): T`, `fork(label: string): Rng`.

- [ ] **Step 1: Write failing tests**
  - same seed → same first 1000 values;
  - different seeds diverge;
  - `next()` over 100 000 draws has mean within 0.01 of 0.5 and all values in [0, 1);
  - `fork('a')` and `fork('b')` from one parent produce different streams and are reproducible.

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.

- [ ] **Step 3: Implement sfc32** seeded through splitmix32. Add the ESLint `no-restricted-properties` rule for `Math.random`.

- [ ] **Step 4: Run to verify they pass.** Also run `npm run lint` on a fixture file that uses `Math.random` under `src/sim/` and confirm it errors. Expected: tests PASS; lint fails on the fixture and passes on the repo.

- [ ] **Step 5: Commit** `feat(core): seeded RNG, lint ban on Math.random in sim`.

### Task 1.3: Tuning constants

**Files:**
- Create: `src/content/tuning.ts`, `tests/unit/tuning.test.ts`

**Interfaces:**
- Consumes: spec §1.2 and §1.4
- Produces: named exports with the legacy names in SCREAMING_SNAKE_CASE, for example `GRAVITY = 22`, `PLAYER_R = 0.35`, `CAPTURE_TIME = 7`, `ZONE_TICKET_COST = 35`, `RESPAWN_TIME = 4`, `ALLY_RESPAWN = 20`, `BLEEDOUT_TIME = 12`, `REVIVE_TIME = 2.5`, `VAULT_TIME = 0.35`, `SLIDE_TIME = 0.85`, `UAV_TIME = 20`, `TURRET_TIME = 45`, `WALL_H = 4.2`, `YAW_PER_PX = 0.0022`.

- [ ] **Step 1: Write a failing test** that asserts each constant equals the legacy value and cites the legacy line in the test name (for example `GRAVITY equals index.html:464`).
- [ ] **Step 2: Run to verify it fails.** Expected: FAIL.
- [ ] **Step 3: Implement** the file, with a one-line comment per constant citing its legacy line.
- [ ] **Step 4: Run to verify it passes.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(content): tuning constants from legacy`.

### Task 1.4: Collision world and raycasts

**Files:**
- Create: `src/sim/collision.ts`, `tests/unit/collision.test.ts`

**Interfaces:**
- Consumes: `tuning.ts`
- Produces:
  - `type Aabb = { min: Vec3; max: Vec3 }` (`Vec3` is `{ x, y, z }`)
  - `class CollisionWorld { add(box: Aabb, opts?: { breakable?: boolean }): BoxId; remove(id: BoxId): void; pushOut(p: Vec2, r: number): void; raycast(o: Vec3, d: Vec3, maxT: number, opts?: { onlyBreakable?: boolean }): { t: number; id: BoxId } | null; pointFree(x: number, z: number, r: number): boolean }`

- [ ] **Step 1: Write failing tests**
  - a ray from the origin along +x hits a box at x = 5 with `t = 5`;
  - a ray parallel to a face and outside its slab misses;
  - a ray starting inside returns `t = 0`;
  - `pushOut` moves a point out to exactly radius `r` from a box edge;
  - a point at a box centre is pushed out along the minimum-depth axis;
  - `pointFree` is false within `r` of a box and true outside.

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** the slab test (legacy `rayBox`, `pushOut`, `pointFree` at `index.html:796–844`). Use an array of boxes with a linear scan; do not optimise yet.
- [ ] **Step 4: Run to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): collision world and raycasts`.

### Task 1.5: Ballistics

**Files:**
- Create: `src/sim/ballistics.ts`, `tests/unit/ballistics.test.ts`

**Interfaces:**
- Consumes: `WeaponDef` shape from `src/content/weapons.ts` (created in this task with the six weapons from spec §1.3)
- Produces:
  - `falloff(distance: number, range: number): number` — 1 up to `range/2`, linear to `0.7` at `range`, clamped beyond
  - `hitDamage(w: WeaponDef, distance: number, head: boolean): number` = `dmg × (head ? headMul : 1) × falloff`
  - `spreadFor(w: WeaponDef, state: { spread: number; ads: boolean; moving: boolean; sprinting: boolean; reflex: boolean }): number`

- [ ] **Step 1: Write failing tests**
  - `falloff(0, 200) === 1`, `falloff(100, 200) === 1`, `falloff(200, 200) === 0.7`, `falloff(150, 200) === 0.85`;
  - VX headshot at 0 m = `24 × 2.5 = 60`;
  - shotgun pellet at 45 m = `11 × 0.7 = 7.7`;
  - ADS halves-ish: ADS multiplier is exactly `0.55`;
  - moving ×1.35, sprinting ×2, Reflex ×0.85 multiply together.

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** and add `weapons.ts` with the six weapons (values from spec §1.3; cite `index.html:486–491`).
- [ ] **Step 4: Run to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): ballistics and weapon defs`.

### Task 1.6: Weapon state machine

**Files:**
- Create: `src/sim/weapons.ts`, `tests/unit/weapons.test.ts`

**Interfaces:**
- Consumes: `WeaponDef`, `hitDamage`, `spreadFor`
- Produces:
  - `makeWeaponState(def: WeaponDef, attachment: Attachment): WeaponState`
  - `tryFire(state: WeaponState, dt?: number): FireResult | null` (`FireResult` has `pellets: number` and `spreadNow: number`)
  - `startReload(state: WeaponState, perk: Perk): boolean`
  - `tickReload(state: WeaponState, dt: number): void`
  - `switchTo(current: WeaponState, next: WeaponState): void` (cancels reload)

- [ ] **Step 1: Write failing tests**
  - VX cooldown after one shot is `60 / 690` s (`index.html:1813`);
  - a full empty magazine reloads in exactly 2.1 s and moves `min(30, 150)` rounds;
  - Fast Hands reload takes 2.1 × 0.7 s;
  - Extended mag gives `Math.round(30 × 1.5) = 45`;
  - Breaker fires 9 pellets;
  - `switchTo` during a reload cancels it;
  - `tryFire` with an empty magazine returns null and starts a reload.

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** from legacy `makeWeapon`, `fire`, `reload`, `updWeapons` (`index.html:1289–1296, 1799–1854`).
- [ ] **Step 4: Run to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(sim): weapon state machine`.

### Task 1.7: Persistence and bindings

**Files:**
- Create: `src/persist/store.ts`, `src/persist/schema.ts`, `src/input/bindings.ts`, `tests/unit/store.test.ts`, `tests/unit/bindings.test.ts`

**Interfaces:**
- Consumes: `content` action list (17 actions from spec §1.6)
- Produces:
  - `loadSettings(storage?: Storage): Settings` and `saveSettings(s: Settings, storage?: Storage): void`; same shape for `loadLoadout`, `loadBindings`, `saveBindings`
  - `class Bindings { get(action): string; set(action, code): void /* swap if taken */; reset(): void; actionFor(code): Action | undefined }`
  - Storage keys `bp_settings`, `bp_loadout`, `bp_binds`, `bp_intro`

- [ ] **Step 1: Write failing tests (Review Focus 1 and 2)**
  - corrupt JSON in any key → defaults returned, no throw;
  - a setting with a wrong type (`sens: "fast"`) → that field defaults, the rest survive;
  - unknown loadout weapon ID → default weapon, other fields kept;
  - binds with an unknown action key are dropped; a missing action gets its default;
  - setting a code already in use swaps the two actions (legacy `index.html:3288`);
  - a storage object whose `getItem` throws → load returns defaults, `saveSettings` doesn't throw;
  - a value written by the legacy file (`bp_settings` with the legacy shape) loads without loss.

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** the versioned loaders. Each field has a validator; invalid fields fall back to defaults individually.
- [ ] **Step 4: Run to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(persist): validated settings, loadout and bindings`.

### Task 1.8: Input adapter and pointer lock

**Files:**
- Create: `src/input/keyboard.ts`, `src/input/mouse.ts`, `src/input/pointer-lock.ts`, `src/input/commands.ts`, `tests/unit/commands.test.ts`, `tests/unit/pointer-lock.test.ts`

**Interfaces:**
- Consumes: `Bindings` from Task 1.7
- Produces:
  - `type Command = { move: { fwd: -1 | 0 | 1; strafe: -1 | 0 | 1 }; look: { dx: number; dy: number }; buttons: { fire: boolean; ads: boolean }; pressed: Set<Action> }`
  - `class InputState { snapshot(): Command; clearHeld(): void }`
  - `class PointerLock { request(): Promise<boolean>; onChange(cb: (locked: boolean) => void): void }`

- [ ] **Step 1: Write failing tests (Review Focus 4)**
  - `snapshot()` maps bound keys to move axes;
  - `clearHeld()` empties held buttons and movement;
  - when `requestPointerLock` rejects, `request()` resolves `false` and emits no unhandled rejection;
  - an unexpected unlock emits `onChange(false)`, which the app uses to pause and clear held input.

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** with `KeyboardEvent.code`, the legacy bindings, and `document.pointerLockElement` (legacy `index.html:3020–3029`).
- [ ] **Step 4: Run to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(input): command snapshot and pointer lock fallback`.

### Task 1.9: Fixed-step simulation and minimal renderer

**Files:**
- Create: `src/sim/world.ts`, `src/sim/movement.ts`, `src/sim/vault.ts`, `src/content/maps/compound.ts`, `src/content/maps/types.ts`, `src/render/renderer.ts`, `src/render/boxes.ts`, `src/app/game.ts`, `src/app/debug-hook.ts`, `tests/unit/movement.test.ts`, `tests/e2e/play-smoke.spec.ts`

**Interfaces:**
- Consumes: `FixedStep` (1.1), `CollisionWorld` (1.4), `tuning` (1.3), `Command` (1.8), `WeaponState` (1.6)
- Produces:
  - `type PlayerState = { pos: Vec3; vel: Vec3; yaw: number; pitch: number; onGround: boolean; crouch: boolean; sliding: number; stamina: number; hp: number; alive: boolean }`
  - `stepPlayer(p: PlayerState, cmd: Command, world: CollisionWorld, dt: number): void`
  - `MapDef` type (zones, spawns, boxes, sky, fog) and `compound: MapDef` (phase 1 uses boxes only)
  - `startGame(root: HTMLElement, debug: boolean): GameHandle`; `GameHandle` exposes `state` read-only in debug mode

- [ ] **Step 1: Write failing movement tests**
  - standing still, forward for 1 s reaches top speed 4.9 m/s within 1% (`index.html:1752`);
  - crouched top speed is 2.3;
  - sprint with Lightweight is 8.6;
  - a jump from rest reaches apex `7.2² / (2 × 22) ≈ 1.178 m` within 1% (`index.html:1765–1770`);
  - sliding needs speed ≥ 4 to start;
  - a box top at 1.0 m, 0.5 m ahead, is vaulted and the player lands past it within 3 m;
  - stepping into a wall stops at radius 0.35.

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** `stepPlayer` from legacy `updPlayer`, `updVault`, `tryVault`, `startSlide` (`index.html:1691–1774`). Build `compound.ts` boxes only (buildings and cover from `index.html:539–546`). Render boxes with three.js. Wire `FixedStep` in `game.ts`. Add a click-to-fire dummy target and a `debug` hook with `window.__bp` read-only getters.

- [ ] **Step 4: Run unit tests.** Expected: PASS.

- [ ] **Step 5: Write the failing E2E smoke test**

```ts
// tests/e2e/play-smoke.spec.ts
test('deploy, move, fire at a dummy', async ({ page }) => {
  await page.goto('/?debug');
  await page.getByRole('button', { name: 'Deploy' }).click();
  await page.getByRole('button', { name: 'Launch mission' }).click();
  const x0 = await page.evaluate(() => (window as any).__bp.P.pos.x);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');
  const z1 = await page.evaluate(() => (window as any).__bp.P.pos.z);
  expect(Math.abs(z1)).toBeGreaterThan(3);
  const shots = await page.evaluate(() => (window as any).__bp.shotsFired ?? 0);
  await page.mouse.down(); await page.mouse.up();
  const after = await page.evaluate(() => (window as any).__bp.shotsFired ?? 0);
  expect(after).toBeGreaterThan(shots);
});
```

Note: the Deploy/Launch flow depends on the phase-5 shell. In P1 the test drives the minimal shell that Task 1.9 adds (a single "Deploy" button). Rewrite the steps in P5 when the real screens land.

- [ ] **Step 6: Run the smoke test on all three browsers.**
Run: `npx playwright test tests/e2e/play-smoke.spec.ts`
Expected: PASS on chromium, firefox, msedge.

- [ ] **Step 7: Deploy the preview and verify**
Open the preview in the built-in browser, deploy, walk and fire. Take a screenshot. Report the result with the screenshot.

- [ ] **Step 8: Commit** `feat(sim): fixed-step player movement and minimal renderer`.

---

## Phases 2–8: outlines

Each phase starts with its own bite-sized plan, written from the spec section named here. Each ends with the gate listed.

### Phase 2: Rendering and maps (spec §1.7, §4)
- **Maps as data.** `content/maps/compound.ts` and `substation.ts` as typed `MapDef`s with the buildings, cover, zones, props and fog values from `index.html:533–563`. Map builder `render/map-builder.ts`: `buildMap(def, scene, world): MapHandle`. Validator test for the five invariants in spec §5, run for both maps.
- **Post and lighting.** `render/post.ts` (bloom 0.22 / 0.5 / 0.92, OutputPass, RoomEnvironment through PMREM). `render/quality.ts` tiers: High and Low, grass 900 / 260, lamps 6, rain on Substation High only. Auto-downgrade governor (FPS < 38 for 5 s) as a pure function, unit tested.
- **Props and FX.** Grass (instanced), lamps (glow sprites), contact shadows, rain (`render/rain.ts`), debris (max 90), holes (max 80), casings (max 24), particle pool (500), tracers, shockwave.
- **Viewmodel.** `render/viewmodel.ts`: spring (stiffness 180, damping 22), look-driven sway with clamps ±0.09 / ±0.07, reload dip, melee thrust, scope overlay (ADS > 0.9). Constants from `index.html:1895–1918`.
- **Context loss.** WebGL context-loss handler: show recovery notice; restore on `webglcontextrestored`. Unit test with a fake canvas event. This closes Review Focus 3.
- **Gate:** both maps screenshot-compared at High and Low; FPS benchmark recorded on the reference machine (§9.3); bundle size measured and the budget written into the spec.

### Phase 3: AI, squad, waves (spec §1.5)
- **Navigation.** `sim/nav/grid.ts`: 120×120 walkability from `CollisionWorld`; A* with an 8000-iteration cap and a per-tick budget of 2 searches. Test: path on Compound avoids every collider; path exists between each spawn and each zone.
- **Hostile AI.** `sim/ai/hostile.ts`: state machines (Guard, Hunt, Engage, TakeCover, Flank, Retreat). `sim/ai/perception.ts`: sight by type, Ghost ×0.7, LOS via raycast, smoke blocks LOS. `sim/ai/cover.ts`: 12 samples, 3–8 m, out of sight. Tests: sniper stays in the 28–40 m band; under 45% hp the hostile seeks cover; intel shares within 18 m; separation 0.9 m.
- **Grenadiers.** Throw at 5–24 m with LOS, cooldown 9–12 s; arc from `index.html:1938–1944`.
- **Operators.** `sim/squad.ts`: orders Attack (range 55, zones), Hold, Follow (4 m, engage 40 m); revive (2.5 s within 2.2 m); bleedout 12 s; respawn 20 s. Tests for each order and revive timing.
- **Waves.** `sim/waves.ts`: composition thresholds and count `min(2 + floor(w/2), 6)`; timer `max(6, base − 0.7w)`. Golden test: seed 1, waves 1–8.
- **Gate:** a seeded 60 s scenario on Compound with no exceptions and with each hostile type observed.

### Phase 4: Match rules (spec §1.1, §1.3, §1.4)
- **Objectives.** `sim/objectives.ts`: capture 7 s, decay ×0.6 time, contested rule, +250 bonus, radius 4.2.
- **Tickets and match.** `sim/tickets.ts` (kill −1, zone −35, win at 0 or all zones, loss at zero reinforcements); `sim/match.ts` state machine (menu → brief → play ⇄ paused → over).
- **Killstreaks.** `sim/killstreaks.ts`: awards at 3 / 5 / 7; UAV 20 s; Sentry (12 dmg per 0.12 s, range 40, 45 s); Airstrike (5 blasts, timing 300 + k·260 ms). Placement rule: nearest clear ground 8, 6, 4, 2 m ahead.
- **Gadgets and breach.** `sim/gadgets.ts` (Frag, Flash, Smoke, Medkit, Drone with uses); `sim/breach.ts` (2 charges, 2.2 s arm, radius 4.5, 110 / 60 dmg). Crate resupply with 30 s cooldown.
- **Scoring.** `sim/scoring.ts`: kill 100 (+50 head), revive 150, capture 250.
- **Gate:** Vitest scenarios for win by tickets, win by capture, loss by reinforcements; E2E win and loss using debug seams.

### Phase 5: Shell and HUD (spec §1.6, §4, §5)
- **Screens.** `ui/screens/`: menu, brief, loadout, settings (Controls, Mouse, Display, Audio), pause, debrief. Same copy and layout as `index.html:256–414`, with the text rules fixed (§1.8).
- **Focus.** `ui/focus.ts`: focus moves to the first control on every screen change; Esc goes back; roving tabindex for option grids; visible focus ring. Keyboard-only E2E path through every screen.
- **HUD.** `ui/hud/`: retained DOM bindings reading a read-only sim view. Same layout as `index.html:182–249`. Colour tokens from `ui/tokens.ts` with a colour-blind variant for every hostile, zone, health and hit colour. Test asserts all tokens exist in both modes.
- **Layout.** Fix the 560 px top strip and right-side feed so they don't overlap at 390 px or 200% zoom. This closes Review Focus 5.
- **Text rules.** Computed-style test over every text node: ≥ 12 px, no uppercase on body, no tracking on body. Uppercase only on labels of three words or fewer.
- **Visual regression and a11y.** Screenshots at 1280×720 and 390×844 for each screen and the HUD (canvas masked). axe-core on every screen.
- **Gate:** every screen reachable and usable by keyboard; visual baselines reviewed by the user.

### Phase 6: Audio (spec §1.7)
- **Graph.** `audio/graph.ts`: master, sfx, ui and ambience buses, `DynamicsCompressorNode` limiter, gain from settings, mute toggle. Context created on first user gesture (matches `index.html:1318`).
- **Synth.** `audio/synth.ts`: the legacy `noise` and `tone` recipes, routed through buses. Pick sounds per event (gunfire by weapon, explosions, pickups, hits, kill tones).
- **Tests.** Unit: bus routing with a fake context. E2E: volume and mute persist; no audio errors in console.
- **Gate:** volume and mute persist; user approves the mix by ear.

### Phase 7: Quality gate and cutover (spec §4)
- **Benchmark.** Scripted 60 s scenario on Compound at High and Low with a seeded squad; frame-time p95 recorded on the reference machine (§9.3).
- **Matrix.** Full E2E on Chromium, Edge and Firefox. Parity gate: `scripts/check-parity.ts` becomes a hard CI failure.
- **Accessibility pass.** axe-core clean on every screen; keyboard-only path passes; colour-blind tokens reviewed.
- **Bundle budget.** Set from measured sizes at the end of phase 2. CI fails over budget.
- **Cutover.** PR `rebuild` → `main`, merged only with your explicit approval. Legacy stays at `/legacy/`. README updated (controls, hosting, tests). Rollback is redeploying the previous `main` commit.

### Phase 8: Backend (spec §2, §9.4)
- **Provisioning.** Only after approval (§9.4). Postgres from the Vercel Marketplace; connection string stored as a Vercel environment variable, never in the repo.
- **API.** `api/scores.ts` (POST match result, GET leaderboard), `api/health.ts`. Validation with a schema; rate limiting per anonymous ID.
- **Match token.** Server issues a short-lived signed match token at match start; results without a valid token are stored unranked.
- **Client.** `net/leaderboard.ts` and `net/queue.ts`: bounded localStorage queue, retries with backoff. The game never waits on the network.
- **Gate:** API unit tests with a mocked DB; E2E: offline play still works and queued results flush when back online.

---

## Self-Review

- **Spec coverage:** §1 features map to phases 1–6 (movement and weapons P1; rendering and maps P2; AI and waves P3; objectives and tickets P4; shell P5; audio P6). §2 stack is in Global Constraints and Phase 0–1 tasks. §3 layers map to the Phase 0 folder layout and the boundary lint rule. §4 quality bar maps to Phase 5 (text, a11y), Phase 2 (fallbacks, governor), Phase 7 (benchmark, matrix). §5 tests map to Tasks 0.3, 0.5, 1.x and each phase gate. §6 non-goals are not planned. §8 phases match this plan's headings. §9 decisions are open.
- **Review Focus coverage:** items 1 and 2 → Task 1.7; 3 → Task 0.3 (boot) and Phase 2 (context loss); 4 → Task 1.8; 5 → Phase 5 layout test and Task 0.3 at 390 px.
- **Type consistency:** `Command` (1.8) is consumed by `stepPlayer` (1.9); `CollisionWorld` (1.4) by `stepPlayer`; `WeaponDef` / `WeaponState` (1.5, 1.6) by the HUD in P5. Names are fixed in the Interfaces blocks above.
- **Placeholder scan:** Phases 2–8 are outlines by design; each is expanded before it starts. Phase 0–1 steps name the exact files, functions and expected results.
- **Proportion:** the plan's detail is in Phases 0–1, where the interfaces are settled. Later phases name their files and gates only, so they can take the decisions the earlier phases make.

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-10-08-breach-protocol-rebuild.md` and the spec to `docs/superpowers/specs/2026-10-08-breach-protocol-rebuild-design.md`, both in `breach-protocol/`. Nothing has been committed yet.

Please review the spec and plan, decide the open items in spec §9, and choose an execution method:

- **Subagent-driven.** A fresh subagent implements each task and a fresh reviewer checks it before the next starts, then a whole-branch review per phase. Most thorough; costs a fresh context per task and per review.
- **Native.** I implement each task myself in this session, then one fresh reviewer checks the whole branch. Cheapest and fastest; less independent review until the end.

For this plan I recommend **subagent-driven**, because the phases are large and the interfaces between tasks must match exactly. A mistake in `Command` or `CollisionWorld` would be expensive to find late.

If you want the parallel fan-out you asked for, I can run each phase's workstreams (sim, rendering, AI, UI, audio, harness) through the workflow tool once you explicitly ask for it.
