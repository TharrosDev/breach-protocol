# Performance

What was changed in the performance pass, what it gained, and how to profile.

## Measured gains (sim, `npx tsx scripts/bench-sim.ts`, Compound, single thread)

| Hot path                                                                         | Before    | After            |
| -------------------------------------------------------------------------------- | --------- | ---------------- |
| `raycast` 40 m at eye level                                                      | 0.0096 ms | 0.0007 ms (14x)  |
| `pointFree`                                                                      | 0.0018 ms | 0.00006 ms (30x) |
| `pushOut`                                                                        | 0.0031 ms | 0.00013 ms (24x) |
| `SimWorld.step`, wave 4 (10 hostiles)                                            | 0.44 ms   | 0.054 ms (8x)    |
| `SimWorld.step`, Substation wave 4 (15 hostiles)                                 | 0.58 ms   | 0.11 ms (5x)     |
| Seeded 60 s scenario (3600 ticks)                                                | 1572 ms   | 185 ms (8.5x)    |
| `scenario-60s.test.ts`                                                           | about 8 s | 0.23 s           |
| A* corner to corner, Compound (after the heap, before the heuristic fix: 3.7 ms) | 3.7 ms    | 1.5 ms           |

The seeded scenario ends in the identical state (same positions, wave and tickets), so behaviour is unchanged.

Static map draw calls (`npx tsx scripts/count-draws.ts`): Compound 298 meshes to 29, Depot 246 to 26, Substation 241 to 23. Each of those was drawn twice a frame (colour and shadow).

Initial JavaScript for the menu: about 730 KB (one bundle with Three.js) down to 70 KB. The match chunk (175 KB) and Three.js (482 KB) load in the background once the menu is up. Post-processing stays a separate on-demand chunk (21 KB).

## What changed

Sim (`src/sim`)

- `CollisionWorld` has a uniform XZ broadphase (4 m cells). Raycast walks the cells it crosses (DDA) and stops at the first hit; `pointFree` and `pushOut` read one cell. Candidates are tested in id order, so results equal the plain loop (a randomised unit test compares both). A box outside the +-80 m grid switches the grid off.
- `visibleTarget` no longer builds candidate arrays, vectors or closures per hostile per tick.
- The AI world object is built once and refreshed per call. `raycast` no longer allocates a default options object.
- A* uses a typed-array heap, and a `sqrt` heuristic instead of `Math.hypot`.

Render (`src/render`)

- Static boxes, props, barrels, roofs, contact shadows and lamp parts are merged per material. Breakable walls and crates that can hide keep their own mesh.
- Debris, casings and bullet holes are `InstancedMesh`. Holes rebuild only when one is added. Tracers use a pool of slots with fixed geometry and materials.
- Particle pools skip their update and GPU upload when empty.
- Static objects have `matrixAutoUpdate = false`.
- The sky draws last with the depth test on, so its cloud and star noise is only shaded where the sky shows.
- Procedural canvas textures (ground, blob, lamp glow, hole, soft dot) are drawn once per page (`texture-cache.ts`).
- High quality: pixel ratio cap 1.5 (was 2), the sun shadow map redrawn every second frame (`shadowEvery`), bloom base mip at half of its old size (`bloomScale`).
- `powerPreference: 'high-performance'`, no stencil buffer.

Loop (`src/app`, `src/core`)

- Dynamic resolution (`ResolutionScaler` in `governor.ts`): below 82 % of the target fps for two samples (1 s) the pixel ratio steps down 10 %, to a floor of 60 %. It steps back up after 4 s at the target, and waits longer each time a rise is followed by a drop. The target is the frame cap, or 60. `?noscale` turns it off. The old quality governor (Low after 5 s under 38 fps) is unchanged.
- `FixedStep` has a max-steps clamp and drops the backlog it cannot run (the game uses 15 steps, the same as the 0.25 s frame clamp, so play is unchanged; lower it to trade speed for smoothness).
- The frame cap is a schedule. The old test landed on every third refresh at 144 Hz (48 fps for a cap of 60).
- Per-frame allocations removed: projection vector, `updateMatrixWorld` once per frame instead of per projected point, pressed-key sets, `forEach` closures, the live-hostile set.
- Audio: background sounds (hostile and squad fire, sentry, medic) are rate limited and dropped when more than 24 sounds started in 0.5 s. Player sounds and blasts are never dropped.
- The match code is a dynamic import prefetched at idle; `manualChunks` splits Three.js and the post-processing modules.

HUD (`src/ui`)

- Minimap redraws at 20 Hz at most, with its colours and view-cone gradient cached.
- Counters, squad, tickets, gadgets and feed refresh at 15 Hz; crosshair, health, ammo, hit marker, compass and projected labels stay per frame.
- `--hud-gap` is set on the crosshair, not the root (a changing custom property on the root restyles the whole HUD). The unused `--hud-hp` write is gone.
- CSS: no `backdrop-filter` on panels; the crosshair moves by `transform`; the zone pulse animates opacity of a pseudo element, not `box-shadow`; an unseen `drop-shadow` filter (cut off by `clip-path`) is gone; `contain` on the HUD root and compass. Reduced motion is still honoured.

## Profiling

- `?perf` (for example `/?perf`) shows an overlay: fps, frame time, CPU time in the frame function, draw calls, triangles, geometries, textures, programs, hostile counts, resolution scale. The same numbers are in `window.__bpPerf`. It costs nothing when absent.
- `?debug` exposes `window.__bp` as before. `?noscale` disables dynamic resolution, for comparing fixed settings.
- `npx tsx scripts/bench-sim.ts` times raycast, `pointFree`, `pushOut`, the sim tick with a wave-4 population, the 60 s scenario and A*.
- `npx tsx scripts/count-draws.ts` counts the meshes that map building produces.
- For a browser trace, use the Performance tab with the overlay on, and look at "frame function" CPU time against frame time: a large gap means GPU or the compositor.

## Not done

- Humans are still about a dozen meshes each (merged per segment, animated by pivots). Skinning or instancing them is a larger rewrite.
- Point lights (zones, muzzle, explosion) are not toggled off when idle: changing the light count recompiles every material.
- No browser profile was taken on the target machine; the render numbers above are structural (draw calls, bundle size), not fps.
