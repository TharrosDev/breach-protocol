# Parity table

Each row maps a feature from the [spec §1](superpowers/specs/2026-10-08-breach-protocol-rebuild-design.md) to the test that pins it. `scripts/check-parity.ts` lists rows whose test file does not exist yet. The check is a report in P0 and a hard gate at P7.

| ID       | Feature                                                                  | Spec § | Test file                        |
| -------- | ------------------------------------------------------------------------ | ------ | -------------------------------- |
| MATCH-01 | Zone capture takes 7 s with friendlies only                              | 1.1    | `tests/unit/objectives.test.ts`  |
| MATCH-02 | Contested zones decay at 0.6× capture rate                               | 1.1    | `tests/unit/objectives.test.ts`  |
| MATCH-03 | Capturing a zone costs enemy 35 tickets; player in zone earns 250        | 1.1    | `tests/unit/tickets.test.ts`     |
| MATCH-04 | Each hostile kill costs enemy 1 ticket; win at 0 tickets or all zones    | 1.1    | `tests/unit/tickets.test.ts`     |
| MATCH-05 | Lose when reinforcements run out                                         | 1.1    | `tests/unit/match.test.ts`       |
| MATCH-06 | Difficulty table (hp, dmg, lives, max hostiles, wave timer, tickets)     | 1.1    | `tests/unit/difficulty.test.ts`  |
| MATCH-07 | Wave count and type thresholds match legacy                              | 1.1    | `tests/unit/waves.test.ts`       |
| MOVE-01  | Walk 4.9 m/s, crouch 2.3, sprint 7.4 (8.6 Lightweight)                   | 1.2    | `tests/unit/movement.test.ts`    |
| MOVE-02  | Jump apex 7.2²/(2·22) m                                                  | 1.2    | `tests/unit/movement.test.ts`    |
| MOVE-03  | Slide starts only at speed ≥ 4 and lasts 0.85 s                          | 1.2    | `tests/unit/movement.test.ts`    |
| MOVE-04  | Vault over low obstacle lands past it within 3 m                         | 1.2    | `tests/unit/movement.test.ts`    |
| MOVE-05  | Stamina drain and regen rates                                            | 1.2    | `tests/unit/movement.test.ts`    |
| MOVE-06  | Passive health regen after 4 s without damage                            | 1.2    | `tests/unit/health.test.ts`      |
| WPN-01   | Ballistics falloff: 1 to half range, 0.7 at max                          | 1.3    | `tests/unit/ballistics.test.ts`  |
| WPN-02   | Headshot multipliers and heavy non-head ×0.6                             | 1.3    | `tests/unit/ballistics.test.ts`  |
| WPN-03   | Spread multipliers: ADS, moving, sprinting, Reflex                       | 1.3    | `tests/unit/ballistics.test.ts`  |
| WPN-04   | Fire interval 60/rpm; reload restores min(missing, reserve)              | 1.3    | `tests/unit/weapons.test.ts`     |
| WPN-05   | Attachments: extended mag, grip, suppressor, reflex                      | 1.3    | `tests/unit/weapons.test.ts`     |
| WPN-06   | Perks: Steady Aim, Fast Hands, Lightweight, Ghost                        | 1.3    | `tests/unit/perks.test.ts`       |
| WPN-07   | Gadgets: uses and effects (frag, flash, smoke, medkit, drone)            | 1.3    | `tests/unit/gadgets.test.ts`     |
| WPN-08   | Melee: 1.7 m cone, 0.9 s cooldown, 150 from behind, 80 front             | 1.3    | `tests/unit/melee.test.ts`       |
| KS-01    | Killstreaks at 3, 5, 7: UAV, Sentry, Airstrike                           | 1.4    | `tests/unit/killstreaks.test.ts` |
| KS-02    | Breach charges: 2 per life, 2.2 s arm, radius 4.5                        | 1.4    | `tests/unit/breach.test.ts`      |
| KS-03    | Crate resupply with 30 s cooldown                                        | 1.4    | `tests/unit/resupply.test.ts`    |
| KS-04    | Scoring: kill 100 (+50 head), revive 150, capture 250                    | 1.4    | `tests/unit/scoring.test.ts`     |
| HOST-01  | Four hostile types with legacy stats                                     | 1.5    | `tests/unit/enemy-defs.test.ts`  |
| HOST-02  | Sniper holds 28–40 m band                                                | 1.5    | `tests/unit/ai.test.ts`          |
| HOST-03  | Hostiles seek cover under 45% hp                                         | 1.5    | `tests/unit/ai.test.ts`          |
| HOST-04  | Intel shares alert within 18 m                                           | 1.5    | `tests/unit/ai.test.ts`          |
| HOST-05  | Operators: orders, revive in 2.5 s, bleedout 12 s, respawn 20 s          | 1.5    | `tests/unit/squad.test.ts`       |
| HOST-06  | Downed player revived by operator within 18 m                            | 1.5    | `tests/unit/squad.test.ts`       |
| SET-01   | Controls: 17 rebindable actions, swap on duplicate                       | 1.6    | `tests/unit/bindings.test.ts`    |
| SET-02   | Settings persist under legacy keys; corrupt data falls back per field    | 1.6    | `tests/unit/store.test.ts`       |
| SET-03   | Auto-downgrade: 5 s below 38 fps sets Low once                           | 1.6    | `tests/unit/governor.test.ts`    |
| SET-04   | Storage blocked: game plays, settings don't persist                      | 1.6    | `tests/unit/store.test.ts`       |
| VIS-01   | Both maps with legacy fog, zones, props and building layout              | 1.7    | `tests/unit/maps.test.ts`        |
| VIS-02   | Quality tiers: grass 900/260, lamps 6, rain on Substation High only      | 1.7    | `tests/unit/quality.test.ts`     |
| VIS-03   | Viewmodel spring and clamps                                              | 1.7    | `tests/unit/viewmodel.test.ts`   |
| VIS-04   | HUD layout and text rules (≥12 px, no uppercase body, no tracking)       | 1.7    | `tests/e2e/text-rules.spec.ts`   |
| VIS-05   | Visual regression: menus and HUD at 1280×720 and 390×844                 | 1.7    | `tests/e2e/visual.spec.ts`       |
| AUD-01   | Procedural SFX on buses; master volume and mute persist                  | 1.7    | `tests/e2e/audio.spec.ts`        |
| A11Y-01  | Keyboard-complete menus; Esc goes back                                   | 4      | `tests/e2e/keyboard.spec.ts`     |
| A11Y-02  | Colour-blind tokens exist for every hostile, zone, health and hit colour | 4      | `tests/unit/tokens.test.ts`      |
| DBG-01   | `?debug` exposes read-only test seams only                               | 1.6    | `tests/e2e/debug-hook.spec.ts`   |
