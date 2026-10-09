// In-match HUD. The DOM is built once in createHud. update() reads a HudView and writes only what changed. The HUD
// never writes game state. Legacy: index.html:182-249 (DOM), 2813-2910 (update), 3318-3412 (compass, spotted boxes,
// hints).
import type { ColourMode, HudView } from '../contracts';
import { hasSeenIntro, markIntroSeen } from '../../persist/store';
import {
  ANNOUNCE_SECONDS,
  FEED_LIFE_SECONDS,
  FEED_MAX,
  FEED_TOKEN,
  HIT_SECONDS,
  HIT_TOKEN,
  VIGNETTE_MAX_OPACITY,
  ZONE_MARK_HEIGHT,
  ZONE_TOKEN,
  clamp01,
  compassOffset,
  feedFade,
  formatAmmo,
  formatHealth,
  formatTimer,
  gapFromSpread,
  hpFraction,
  isLowHealth,
  killstreakProgress,
  matchFeed,
  scaleX,
  squadFraction,
  ticketFraction,
  tokenVar,
  zoneBearing,
  type FeedKey,
  type HitKind,
  type ScreenPoint,
  type WorldProjector,
} from './layout';
import { createMinimap, MINIMAP_PX, type MinimapMap, type Point2 } from './minimap';
import { createSpotBoxes, setAttr, setFlag, setHidden, setStyle, setText } from './effects';

// One operator as the squad cards and the minimap need it. The HudView has no per-operator data.
export interface HudOperator {
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly x: number;
  readonly z: number;
}

// One row of the Tab scoreboard (legacy #sbBody, index.html:2885-2894). The text is already formatted.
export interface ScoreboardRow {
  readonly name: string;
  readonly score: string;
  readonly kills: string;
  readonly deaths: string;
  readonly status: string;
}

export interface HudExtras {
  // AI operators, not counting the player. The first two get squad cards; alive ones are minimap dots.
  readonly operators?: readonly HudOperator[];
  // Weapon spread, for the crosshair gap. Missing means no spread.
  readonly spread?: number;
  // Key label shown after the squad order, for example 'V'. Omitted when missing.
  readonly orderKey?: string;
  // The Tab scoreboard (legacy #sb, index.html:2899-2900). True shows the table. Missing means hidden.
  readonly scoreboard?: boolean;
  // The scoreboard rows, the player first and then the operators. Missing means no rows.
  readonly scoreboardRows?: readonly ScoreboardRow[];
  // The scoreboard footer line (layout.ts scoreboardFooter). Missing means an empty footer.
  readonly scoreboardFooter?: string;
}

export interface HudOptions {
  // Zone positions (in the order of view.zones) and map boxes, for the minimap and the compass zone markers.
  readonly mapDef?: MinimapMap;
  // World to root pixel projection, for zone labels and spotted boxes. Without it those are hidden.
  readonly project?: WorldProjector;
}

// Key labels for the one-time intro hints. Each is a display string, for example 'W A S D' or 'Shift'.
export interface IntroKeys {
  readonly move: string;
  readonly sprint: string;
  readonly crouch: string;
  readonly reload: string;
  readonly melee: string;
  readonly interact: string;
  readonly order: string;
  readonly scoreboard: string;
}

export interface Hud {
  update(view: HudView, dt: number, extras?: HudExtras): void;
  setVisible(visible: boolean): void;
  setColourMode(mode: ColourMode): void;
  showIntroHints(keys: IntroKeys): void;
  dispose(): void;
}

const TICK_COUNT = 24;
const TICK_STEP_DEG = 15;
const SQUAD_CARDS = 2;
// The scoreboard has the player and one row per squad card (legacy updScoreboard, index.html:2885-2894).
const SCOREBOARD_ROWS = 1 + SQUAD_CARDS;
const SCOREBOARD_HEADERS = ['Operator', 'Score', 'K', 'D', 'Status'] as const;
const ZONE_CARDS = 3;
const ZONE_MARKS = 3;
const COMPASS_LABELS: readonly { readonly text: string; readonly angle: number }[] = [
  { text: 'N', angle: 0 },
  { text: 'E', angle: Math.PI / 2 },
  { text: 'S', angle: Math.PI },
  { text: 'W', angle: -Math.PI / 2 },
];
// Legacy intro hint timing (index.html:3402-3417): the first hint now, the next two after 6 s and 12 s.
const HINT_FIRST_MS = 5500;
const HINT_SECOND_AT_MS = 6000;
const HINT_SECOND_MS = 5000;
const HINT_THIRD_AT_MS = 12000;
const HINT_THIRD_MS = 6000;

interface GadgetSlot {
  readonly node: HTMLElement;
  readonly key: HTMLElement;
  readonly text: HTMLElement;
}

interface FeedRecord {
  readonly key: FeedKey;
  readonly born: number;
}

export function createHud(root: HTMLElement, options: HudOptions = {}): Hud {
  const doc = root.ownerDocument;
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls: string,
    parent?: Element,
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (cls !== '') node.className = cls;
    parent?.append(node);
    return node;
  };

  root.classList.add('hud');
  root.dataset.colour = 'normal';

  // Full-screen layers, under the panels.
  const whiteout = make('div', 'hud-fx hud-whiteout', root);
  const vignette = make('div', 'hud-fx hud-vig', root);
  const cross = make('div', 'hud-cross', root);
  for (let i = 0; i < 4; i++) make('i', '', cross);
  const hitMarker = make('div', 'hud-hitm', root);
  const spots = createSpotBoxes(root);
  const worldLabels: HTMLElement[] = [];
  for (let i = 0; i < ZONE_MARKS; i++) worldLabels.push(make('div', 'hud-wm', root));

  // Left column: score panel, then the squad cards.
  const left = make('div', 'hud-left', root);
  const tl = make('div', 'hud-panel hud-tl', left);
  const scoreEl = make('div', 'hud-score', tl);
  const hostilesEl = make('div', 'hud-lbl', tl);
  const reinforcementsEl = make('div', 'hud-lbl', tl);
  const operatorsEl = make('div', 'hud-lbl', tl);
  const orderEl = make('div', 'hud-lbl hud-order', tl);
  const squad = make('div', 'hud-panel hud-squad', left);
  make('div', 'hud-lbl', squad).textContent = 'Squad';
  const squadList = make('div', 'hud-squad-list', squad);
  const squadCards = Array.from({ length: SQUAD_CARDS }, () => {
    const card = make('div', 'hud-sq', squadList);
    const name = make('div', 'hud-sqn', card);
    const fill = make('i', '', make('div', 'hud-bar', card));
    return { card, name, fill };
  });

  // Top bar: compass strip, zone cards, enemy tickets.
  const top = make('div', 'hud-top', root);
  const compass = make('div', 'hud-compass', top);
  const tape = make('div', 'hud-tape', compass);
  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => ({
    node: make('div', 'hud-ct', tape),
    angle: (i * TICK_STEP_DEG * Math.PI) / 180,
  }));
  const compassLabels = COMPASS_LABELS.map((label) => {
    const node = make('div', 'hud-cl', tape);
    node.textContent = label.text;
    return { node, angle: label.angle };
  });
  const zoneMarks = Array.from({ length: ZONE_MARKS }, () => make('div', 'hud-cz', tape));
  const zonesRow = make('div', 'hud-zones', top);
  const zoneCards = Array.from({ length: ZONE_CARDS }, () => {
    const card = make('div', 'hud-zn', zonesRow);
    const name = make('b', '', card);
    const fill = make('i', '', make('div', 'hud-bar', card));
    return { card, name, fill };
  });
  const etk = make('div', 'hud-etk', top);
  etk.append('Enemy tickets');
  const etkFill = make('i', '', make('div', 'hud-bar hud-etk-bar', etk));

  // Right column: minimap, then the feed.
  const right = make('div', 'hud-right', root);
  const mm = make('canvas', 'hud-mm', right);
  mm.width = MINIMAP_PX;
  mm.height = MINIMAP_PX;
  const feed = make('div', 'hud-feed', right);
  const feedSlots = Array.from({ length: FEED_MAX }, () => {
    const node = make('div', 'hud-fd', feed);
    node.hidden = true;
    return node;
  });

  const announce = make('div', 'hud-announce', root);
  const announceMain = make('div', 'hud-announce-main', announce);
  const announceSub = make('small', 'hud-announce-sub', announce);
  const hint = make('div', 'hud-hint', root);
  const prompt = make('div', 'hud-prompt', root);
  const kia = make('div', 'hud-kia', root);
  kia.hidden = true;
  const kiaMain = make('span', 'hud-kia-main', kia);
  const kiaSub = make('small', 'hud-kia-sub', kia);

  // Bottom-left: health and stamina.
  const bl = make('div', 'hud-panel hud-bl', root);
  make('div', 'hud-lbl', bl).textContent = 'Health';
  const hpNum = make('div', 'hud-hp-num', bl);
  const hpFill = make('i', '', make('div', 'hud-bar hud-hp', bl));
  make('div', 'hud-lbl hud-stamina-lbl', bl).textContent = 'Stamina';
  const staminaFill = make('i', '', make('div', 'hud-bar hud-stamina', bl));

  // Bottom-right: weapon, ammo, gadgets, breach, killstreak.
  const br = make('div', 'hud-panel hud-br', root);
  const weaponEl = make('div', 'hud-lbl', br);
  const ammoEl = make('div', 'hud-ammo', br);
  const gad = make('div', 'hud-gad', br);
  const breachSlot = make('div', 'hud-gslot', gad);
  const breachKey = make('kbd', '', breachSlot);
  const breachText = make('b', '', breachSlot);
  const gadgetSlots: GadgetSlot[] = [];
  const ks = make('div', 'hud-ks', br);
  const ksFill = make('i', '', make('div', 'hud-bar hud-ks-bar', br));

  // Tab scoreboard, centred over the play area (legacy #sb). Hidden unless the caller says the key is held.
  const sb = make('div', 'hud-sb', root);
  sb.hidden = true;
  const sbTable = make('table', '', sb);
  const sbHeadRow = make('tr', '', make('thead', '', sbTable));
  for (const label of SCOREBOARD_HEADERS) make('th', 'hud-lbl', sbHeadRow).textContent = label;
  const sbBody = make('tbody', '', sbTable);
  const sbRows = Array.from({ length: SCOREBOARD_ROWS }, () => {
    const tr = make('tr', '', sbBody);
    const cells = SCOREBOARD_HEADERS.map(() => make('td', '', tr));
    return { tr, cells };
  });
  const sbFootCell = make('td', 'hud-sb-foot', make('tr', '', make('tfoot', '', sbTable)));
  sbFootCell.colSpan = SCOREBOARD_HEADERS.length;

  const minimap = createMinimap(mm, options.mapDef);

  const timers: ReturnType<typeof setTimeout>[] = [];
  let disposed = false;
  let clock = 0;
  let hitKind: HitKind = 'hit';
  let hitTimer = 0;
  let announceKey: string | null = null;
  let announceTimer = 0;
  let feedRecord: FeedRecord[] = [];
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  function createGadgetSlot(): GadgetSlot {
    const node = make('div', 'hud-gslot');
    gad.insertBefore(node, breachSlot);
    return { node, key: make('kbd', '', node), text: make('b', '', node) };
  }

  function placeOnCompass(node: HTMLElement, bearing: number, yaw: number): void {
    const o = compassOffset(bearing, yaw);
    setHidden(node, !o.visible);
    setStyle(node, 'left', `${o.percent.toFixed(2)}%`);
  }

  function updateCompass(view: HudView): void {
    const yaw = view.compassYaw;
    for (const t of ticks) placeOnCompass(t.node, t.angle, yaw);
    for (const l of compassLabels) placeOnCompass(l.node, l.angle, yaw);
    const zones = options.mapDef?.zones ?? [];
    zoneMarks.forEach((node, i) => {
      const zone = zones[i];
      const state = view.zones[i];
      if (zone === undefined || state === undefined) {
        setHidden(node, true);
        return;
      }
      placeOnCompass(node, zoneBearing(view.playerX, view.playerZ, zone.x, zone.z), yaw);
      setStyle(node, 'background', tokenVar(ZONE_TOKEN[state.status]));
    });
  }

  function updateWorldLabels(view: HudView, project: WorldProjector | undefined): void {
    const zones = options.mapDef?.zones ?? [];
    worldLabels.forEach((node, i) => {
      const zone = zones[i];
      const state = view.zones[i];
      let p: ScreenPoint | undefined;
      if (zone !== undefined && project !== undefined) p = project(zone.x, ZONE_MARK_HEIGHT, zone.z);
      if (zone === undefined || state === undefined || p === undefined || !p.onScreen) {
        setHidden(node, true);
        return;
      }
      setHidden(node, false);
      setStyle(node, 'left', `${p.x.toFixed(0)}px`);
      setStyle(node, 'top', `${p.y.toFixed(0)}px`);
      const dist = Math.hypot(zone.x - view.playerX, zone.z - view.playerZ);
      setText(
        node,
        state.status === 'captured'
          ? `${state.name} · secured`
          : `${state.name} · ${String(Math.round(dist))}m`,
      );
    });
  }

  function updateTopBar(view: HudView): void {
    zoneCards.forEach((z, i) => {
      const state = view.zones[i];
      setHidden(z.card, state === undefined);
      if (state === undefined) return;
      setText(z.name, state.name);
      setAttr(z.card, 'data-s', state.status);
      setStyle(z.fill, 'background', tokenVar(ZONE_TOKEN[state.status]));
      setStyle(z.fill, 'transform', scaleX(clamp01(state.prog)));
    });
    setStyle(etkFill, 'transform', scaleX(ticketFraction(view.tickets, view.ticketsStart)));
  }

  function updateSquad(operators: readonly HudOperator[]): void {
    squadCards.forEach((c, i) => {
      const op = operators[i];
      setHidden(c.card, op === undefined);
      if (op === undefined) return;
      setFlag(c.card, 'dead', !op.alive);
      setText(c.name, op.alive ? op.name : `${op.name} · down`);
      setStyle(c.fill, 'transform', scaleX(squadFraction(op.hp, op.maxHp)));
    });
  }

  function updateGadgets(view: HudView): void {
    while (gadgetSlots.length < view.gadgets.length) gadgetSlots.push(createGadgetSlot());
    gadgetSlots.forEach((slot, i) => {
      const g = view.gadgets[i];
      setHidden(slot.node, g === undefined);
      if (g === undefined) return;
      setText(slot.key, g.key);
      setText(slot.text, `${g.name} ×${String(g.uses)}`);
      setFlag(slot.node, 'empty', g.uses <= 0);
    });
    setText(breachKey, view.breachKey);
    setText(breachText, `Breach ×${String(view.breachCharges)}`);
    setFlag(breachSlot, 'empty', view.breachCharges <= 0);
  }

  function updateKillstreak(view: HudView): void {
    const ready = view.killstreakReady;
    if (ready !== null) {
      setText(ks, `Killstreak ready: ${ready} [${view.killstreakKey}]`);
    } else if (view.nextStreakAt !== null) {
      setText(ks, `Streak ${String(view.streak)} · next reward at ${String(view.nextStreakAt)}`);
    } else {
      setText(ks, `Streak ${String(view.streak)}`);
    }
    setStyle(ksFill, 'transform', scaleX(killstreakProgress(view.streak, view.nextStreakAt, ready !== null)));
  }

  function updateKia(view: HudView): void {
    let main = '';
    let sub = '';
    if (view.downed) {
      main = `Down · bleeding out ${formatTimer(view.bleedout)}s`;
      sub = 'A squadmate can revive you';
    } else if (!view.alive) {
      main = `Eliminated · respawn in ${formatTimer(view.respawnIn)}s`;
    }
    setText(kiaMain, main);
    setText(kiaSub, sub);
    setHidden(kiaSub, sub === '');
    setHidden(kia, main === '');
  }

  function updateScoreboard(extras: HudExtras): void {
    const open = extras.scoreboard === true;
    setHidden(sb, !open);
    if (!open) return;
    const rows = extras.scoreboardRows ?? [];
    sbRows.forEach((r, i) => {
      const row = rows[i];
      setHidden(r.tr, row === undefined);
      if (row === undefined) return;
      const values = [row.name, row.score, row.kills, row.deaths, row.status];
      r.cells.forEach((cell, j) => {
        setText(cell, values[j] ?? '');
      });
    });
    setText(sbFootCell, extras.scoreboardFooter ?? '');
  }

  function updateAnnounce(view: HudView, step: number): void {
    const ann = view.announce;
    const key = ann === null ? null : `${ann.text}\n${ann.sub}`;
    if (key !== announceKey) {
      announceKey = key;
      if (ann !== null) {
        announceTimer = ANNOUNCE_SECONDS;
        setText(announceMain, ann.text);
        setText(announceSub, ann.sub);
        setHidden(announceSub, ann.sub === '');
      }
    }
    announceTimer = Math.max(0, announceTimer - step);
    setFlag(announce, 'on', ann !== null && announceTimer > 0);
  }

  function updateFeed(view: HudView): void {
    const map = matchFeed(
      feedRecord.map((r) => r.key),
      view.feed,
    );
    const previous = feedRecord;
    feedRecord = view.feed.map((entry, i) => {
      const j = map[i];
      const old = j === undefined || j < 0 ? undefined : previous[j];
      return { key: { text: entry.text, cls: entry.cls }, born: old === undefined ? clock : old.born };
    });
    const shown = feedRecord
      .map((r) => ({ r, age: clock - r.born }))
      .filter((x) => x.age < FEED_LIFE_SECONDS)
      .slice(0, FEED_MAX);
    feedSlots.forEach((node, i) => {
      const item = shown[i];
      setHidden(node, item === undefined);
      if (item === undefined) return;
      setText(node, item.r.key.text);
      setStyle(node, 'color', tokenVar(FEED_TOKEN[item.r.key.cls]));
      setStyle(node, 'opacity', feedFade(item.age).toFixed(3));
    });
  }

  function updateHitMarker(view: HudView, step: number): void {
    if (view.hitMarker !== 'none') {
      hitKind = view.hitMarker;
      hitTimer = HIT_SECONDS[hitKind];
    } else {
      hitTimer = Math.max(0, hitTimer - step);
    }
    setFlag(hitMarker, 'on', hitTimer > 0);
    setStyle(hitMarker, '--hud-hit', tokenVar(HIT_TOKEN[hitKind]));
  }

  function update(view: HudView, dt: number, extras: HudExtras = {}): void {
    if (disposed) return;
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    clock += step;
    const operators = extras.operators ?? [];

    setStyle(root, '--hud-gap', `${gapFromSpread(extras.spread ?? 0).toFixed(1)}px`);
    setStyle(whiteout, 'opacity', clamp01(view.whiteout).toFixed(3));
    setStyle(vignette, 'opacity', (clamp01(view.hurt) * VIGNETTE_MAX_OPACITY).toFixed(3));

    setText(scoreEl, `Score ${String(view.score)}`);
    setText(hostilesEl, `Hostiles ${String(view.hostilesAlive)}`);
    setText(reinforcementsEl, `Reinforcements ${String(view.reinforcements)}`);
    setText(operatorsEl, `Operators ${String(view.operatorsAlive)}/${String(view.operatorsTotal)}`);
    setText(
      orderEl,
      `Squad: ${view.squadOrder}${extras.orderKey === undefined ? '' : ` [${extras.orderKey}]`}`,
    );

    updateSquad(operators.slice(0, SQUAD_CARDS));
    updateCompass(view);
    updateTopBar(view);

    setText(hpNum, formatHealth(view.hp));
    setStyle(hpFill, 'transform', scaleX(hpFraction(view.hp)));
    setFlag(bl, 'low', isLowHealth(view.hp));
    setStyle(staminaFill, 'transform', scaleX(clamp01(view.stamina)));

    setText(weaponEl, view.weaponName);
    setText(ammoEl, formatAmmo(view.ammo, view.reserve, view.reloading));
    updateGadgets(view);
    updateKillstreak(view);

    updateHitMarker(view, step);
    updateKia(view);
    updateScoreboard(extras);
    setText(prompt, view.prompt);
    updateAnnounce(view, step);
    updateFeed(view);

    const project = options.project;
    updateWorldLabels(view, project);
    spots.update(view.spotted, project, view.playerX, view.playerZ);
    minimap.draw(
      view,
      operators.filter((o) => o.alive).map((o): Point2 => ({ x: o.x, z: o.z })),
    );
  }

  // One hint line at a time. Each show clears the previous hide timer.
  function showHint(text: string, ms: number): void {
    setText(hint, text);
    hint.classList.add('on');
    if (hintTimer !== undefined) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hint.classList.remove('on');
    }, ms);
  }

  function schedule(ms: number, fn: () => void): void {
    timers.push(setTimeout(fn, ms));
  }

  return {
    update,
    setVisible(visible) {
      root.hidden = !visible;
    },
    setColourMode(mode) {
      root.dataset.colour = mode;
      spots.setMode(mode);
      minimap.invalidate();
    },
    showIntroHints(keys) {
      // Shown once per browser: the legacy 'bp_intro' flag, read and written through the store.
      if (hasSeenIntro()) return;
      markIntroSeen();
      showHint(`${keys.move} move · ${keys.sprint} sprint · ${keys.crouch} crouch`, HINT_FIRST_MS);
      schedule(HINT_SECOND_AT_MS, () => {
        showHint(`Right mouse to aim · ${keys.reload} reload · ${keys.melee} melee`, HINT_SECOND_MS);
      });
      schedule(HINT_THIRD_AT_MS, () => {
        showHint(
          `${keys.interact} resupply at a crate · ${keys.order} squad orders · ${keys.scoreboard} scoreboard`,
          HINT_THIRD_MS,
        );
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      if (hintTimer !== undefined) clearTimeout(hintTimer);
      root.replaceChildren();
      root.classList.remove('hud');
      root.removeAttribute('data-colour');
    },
  };
}
