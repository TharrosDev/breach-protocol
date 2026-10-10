// Pure model for the Phase 5 menu screens. No DOM and no sim imports: each screen feeds plain data in and renders
// what these helpers return. Copy tables cite the legacy lines they come from (public/index.html).
import type { FocusScope } from '../contracts';
import { DIFF } from '../../content/difficulty';
import { GADGETS } from '../../content/gadgets';
import type { Action, AttachmentId, GadgetId, PerkId, PrimaryWeaponId } from '../../content/ids';
import { getMap } from '../../content/maps';
import { WEAPONS } from '../../content/weapons';
import { Bindings } from '../../input/bindings';
import type { Loadout } from '../../persist/schema';

export type BindingMap = Readonly<Record<Action, string>>;

// The focus scope the screens use. The integration passes the real one from focus.ts.
export type FocusLike = Pick<FocusScope, 'activate' | 'deactivate' | 'focusFirst'>;

export interface TileText {
  title: string;
  sub: string;
}

export interface TileValue {
  label: string;
  value: string;
}

export interface StatBar {
  label: string;
  // 0..100, the bar width in percent.
  pct: number;
}

export interface ControlRow {
  // Key caps shown in the left cell. Two keys are shown with a space between them, as in the legacy list.
  keys: string[];
  text: string;
}

export interface ScoreLineInput {
  score: number;
  kills: number;
  deaths: number;
  zonesCaptured: number;
  zonesTotal: number;
  seconds: number;
  mapName: string;
  difficulty: string;
}

export interface DebriefZone {
  name: string;
  captured: boolean;
}

// The match result as the debrief needs it. The caller fills shots, hits and streak (MatchResult does not carry them).
export interface DebriefInput extends ScoreLineInput {
  win: boolean;
  shots: number;
  hits: number;
  streak: number;
  zones: readonly DebriefZone[];
}

export interface PerformanceStats {
  kills: number;
  deaths: number;
  score: number;
  shots: number;
  hits: number;
  seconds: number;
  streak: number;
}

export interface CalcText {
  // Legacy updateCalc (index.html:2769-2776). The label is shown in bold by the screen.
  hip: string;
  ads: string;
}

// Legacy gadget limit: the loadout holds two gadgets (index.html:569-575).
export const GADGET_LIMIT = 2;

// Inches to centimetres. The yaw per pixel (YAW_PER_PX, content/tuning.ts) is passed in by the caller.
const CM_PER_INCH = 2.54;

interface NamedText {
  name: string;
  desc: string;
}

// index.html:486-493 (descriptions of the five primary weapons, in loadout order).
export const PRIMARY_DESC: Readonly<Record<PrimaryWeaponId, string>> = {
  vx: 'Balanced assault rifle',
  kv: 'Very fast fire, close quarters',
  bk: 'Devastating up close',
  lm: 'Huge magazine, slow reload',
  dm: 'Precision semi-auto, scoped',
  rc: 'Three-round burst carbine, accurate',
  lb: 'Bolt-action sniper, one shot one kill',
  hp: 'Compact PDW, fastest fire, low recoil',
};

// index.html:496-502
export const ATTACHMENT_INFO: Readonly<Record<AttachmentId, NamedText>> = {
  none: { name: 'None', desc: 'No attachment.' },
  suppressor: { name: 'Suppressor', desc: 'Near-silent. Enemies only notice you up close.' },
  extmag: { name: 'Extended mag', desc: '+50% magazine capacity.' },
  grip: { name: 'Vertical grip', desc: '30% less recoil.' },
  reflex: { name: 'Reflex optic', desc: 'Tighter spread and faster aim-down-sights.' },
  compensator: { name: 'Compensator', desc: '25% less recoil and slower spread bloom.' },
  hollow: { name: 'Hollow points', desc: '+20% damage, 25% less reserve ammo.' },
};

// index.html:504-509
export const PERK_INFO: Readonly<Record<PerkId, NamedText>> = {
  steady: { name: 'Steady Aim', desc: 'Less recoil, spread recovers twice as fast.' },
  fasthands: { name: 'Fast Hands', desc: 'Reloads 30% faster.' },
  lightweight: { name: 'Lightweight', desc: 'Faster sprint, stamina drains slower.' },
  ghost: { name: 'Ghost', desc: 'Enemies spot you from 30% less far away.' },
  scavenger: { name: 'Scavenger', desc: 'Kills drop ammo back into your reserve.' },
  adrenaline: { name: 'Adrenaline', desc: 'Each kill restores 15 health.' },
};

// Legacy stat bars (index.html:2716-2721): each value is divided by a scale and capped at 100.
export function primaryBars(id: PrimaryWeaponId): StatBar[] {
  const w = WEAPONS[id];
  return [
    { label: 'Damage', pct: Math.min(100, w.dmg / 0.6) },
    { label: 'Rate', pct: Math.min(100, w.rpm / 9) },
    { label: 'Magazine', pct: Math.min(100, w.mag / 0.9) },
    { label: 'Range', pct: Math.min(100, w.range / 2.5) },
  ];
}

// The loadout screen's bars: what a weapon does per trigger pull, how fast it fires, how far it reaches and how
// controllable it is. Control falls with recoil, yaw kick and spread. A shotgun's pellets count at 45% (they rarely
// all land). Every value is 0..100.
export function weaponStatBars(id: PrimaryWeaponId): StatBar[] {
  const w = WEAPONS[id];
  const perPull = w.dmg * (w.pellets > 1 ? w.pellets * 0.45 : 1);
  const control = 100 - Math.min(95, w.recoil * 1100 + w.recoilYaw * 2500 + w.spread * 700);
  const clampPct = (v: number): number => Math.max(0, Math.min(100, v));
  return [
    { label: 'Damage', pct: clampPct(100 * (perPull / 110) ** 0.7) },
    { label: 'Rate', pct: clampPct(w.rpm / 10) },
    { label: 'Range', pct: clampPct(w.range / 3.5) },
    { label: 'Control', pct: clampPct(control) },
    { label: 'Magazine', pct: clampPct(w.mag / 0.9) },
  ];
}

// Legacy tile list (index.html:2711-2713, loadoutTiles): weapon and attachment, perk, gadgets, map and difficulty.
export function loadoutTiles(l: Loadout): TileText[] {
  return [
    { title: WEAPONS[l.primary].name, sub: `${ATTACHMENT_INFO[l.attachment].name} attachment` },
    { title: PERK_INFO[l.perk].name, sub: 'Perk' },
    { title: l.gadgets.map((g) => GADGETS[g].name).join(' + '), sub: 'Gadgets' },
    { title: getMap(l.map).name, sub: `${DIFF[l.difficulty].name} difficulty` },
  ];
}

// Legacy gadget toggle (bindLoadout, index.html:2729-2748). A selected gadget is removed. A new one is added, and at
// the limit the oldest selection is dropped first. The result can hold fewer than two gadgets when one is removed.
export function loadoutGadgetToggle(current: readonly GadgetId[], id: GadgetId): GadgetId[] {
  if (current.includes(id)) return current.filter((g) => g !== id);
  const next = [...current];
  while (next.length >= GADGET_LIMIT) next.shift();
  next.push(id);
  return next;
}

// Legacy key names (index.html:3219-3220). Key codes outside the table show their letter or digit.
const KEY_NAMES: ReadonlyMap<string, string> = new Map([
  ['ControlLeft', 'Ctrl'],
  ['ShiftLeft', 'Shift'],
  ['Space', 'Space'],
  ['Tab', 'Tab'],
  ['Digit1', '1'],
  ['Digit2', '2'],
]);

export function keyLabel(code: string): string {
  const named = KEY_NAMES.get(code);
  if (named !== undefined) return named;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

// The Controls list (index.html:257-287). Every key cap comes from the live bindings. LMB and RMB are fixed mouse
// buttons, as in the legacy list.
export function controlRows(b: BindingMap, keyName: (code: string) => string): ControlRow[] {
  const k = (action: Action): string => keyName(b[action]);
  return [
    { keys: [[k('forward'), k('left'), k('back'), k('right')].join('')], text: 'Move' },
    { keys: [k('sprint')], text: 'Sprint (uses stamina)' },
    { keys: [k('crouch')], text: 'Crouch (hold). Tap while sprinting to slide.' },
    { keys: [k('jump')], text: 'Jump. Jump at a low crate or sandbag to vault it.' },
    { keys: ['LMB'], text: 'Fire' },
    { keys: ['RMB'], text: 'Aim down sights (the DMR has a scope)' },
    { keys: [k('reload')], text: 'Reload' },
    { keys: [k('weapon1'), k('weapon2')], text: 'Primary / sidearm' },
    { keys: [k('gadget1'), k('gadget2')], text: 'Gadget slot 1 / slot 2' },
    {
      keys: [k('interact')],
      text: 'Resupply at a crate, otherwise place a breach charge on a reinforced wall',
    },
    { keys: [k('melee')], text: 'Melee knife (hit from behind for extra damage)' },
    { keys: [k('order')], text: 'Squad order: Attack / Hold / Follow' },
    { keys: [k('killstreak')], text: 'Use a stored killstreak' },
    { keys: [k('scoreboard')], text: 'Scoreboard' },
  ];
}

// The gamepad layout (src/input/gamepad.ts), as shown on the settings screen.
export const PAD_ROWS: readonly ControlRow[] = [
  { keys: ['LS'], text: 'Move' },
  { keys: ['RS'], text: 'Look' },
  { keys: ['RT'], text: 'Fire' },
  { keys: ['LT'], text: 'Aim down sights' },
  { keys: ['A'], text: 'Jump or vault' },
  { keys: ['B'], text: 'Crouch (hold)' },
  { keys: ['L3'], text: 'Sprint (hold)' },
  { keys: ['X'], text: 'Reload' },
  { keys: ['Y'], text: 'Swap weapon' },
  { keys: ['LB', 'RB'], text: 'Gadget slot 1 / slot 2' },
  { keys: ['R3'], text: 'Melee knife' },
  { keys: ['D-pad up'], text: 'Use a stored killstreak' },
  { keys: ['D-pad left'], text: 'Squad order' },
  { keys: ['D-pad right'], text: 'Resupply or place a breach charge' },
  { keys: ['D-pad down'], text: 'Scoreboard (hold)' },
  { keys: ['Start'], text: 'Pause' },
];

// The brief's win conditions (index.html:3313).
export function winConditionText(zones: number, tickets: number, lives: number, zoneCost: number): string {
  return (
    `Capture all ${String(zones)} objectives, or drive the enemy's ${String(tickets)} tickets to zero. ` +
    `You have ${String(lives)} reinforcements. Each hostile killed costs them one ticket; ` +
    `each captured zone costs them ${String(zoneCost)}.`
  );
}

// The debrief sentence. Same format as sim/match.ts formatScoreLine (index.html:2649), copied here so the screens
// do not import the sim.
export function scoreLineSample(r: ScoreLineInput): string {
  return (
    `Score ${String(r.score)} · ${String(r.kills)} eliminations · ${String(r.deaths)} deaths · ` +
    `${String(r.zonesCaptured)}/${String(r.zonesTotal)} objectives · ` +
    `${String(Math.floor(r.seconds))}s · ${r.mapName}, ${r.difficulty}`
  );
}

// The six performance tiles (index.html:2652-2657). Accuracy shows a dash when no shot was fired.
export function tileValues(s: PerformanceStats): TileValue[] {
  const accuracy = s.shots > 0 ? `${String(Math.round((100 * s.hits) / s.shots))}%` : '–';
  return [
    { label: 'Eliminations', value: String(s.kills) },
    { label: 'Deaths', value: String(s.deaths) },
    { label: 'Score', value: s.score.toLocaleString() },
    { label: 'Accuracy', value: accuracy },
    { label: 'Time in match', value: `${String(Math.floor(s.seconds))}s` },
    { label: 'Current streak', value: String(s.streak) },
  ];
}

// Legacy headings (index.html:2648).
export function debriefHeading(win: boolean): string {
  return win ? 'Sector Secured' : 'Mission Failed';
}

// Legacy calculator (index.html:2769-2776). Yaw per pixel is passed in (YAW_PER_PX).
export function calcCmPer360(sens: number, dpi: number, yawPerPx: number): { inches: number; cm: number } {
  const pxPer360 = (Math.PI * 2) / (yawPerPx * sens);
  const inches = pxPer360 / dpi;
  return { inches, cm: inches * CM_PER_INCH };
}

export function calcCmAds(cm: number, adsMul: number): number {
  return cm / Math.max(0.05, adsMul);
}

export function calcText(sens: number, dpi: number, adsMul: number, yawPerPx: number): CalcText {
  const { inches, cm } = calcCmPer360(sens, dpi, yawPerPx);
  const ads = calcCmAds(cm, adsMul);
  return {
    hip: `${inches.toFixed(1)} in / ${cm.toFixed(1)} cm of mouse travel at ${String(dpi)} DPI.`,
    ads: `${ads.toFixed(1)} cm for the same turn.`,
  };
}

// Rebinding through the Bindings class, so taking a code that another action holds swaps the two (bindings.ts).
export function applyRebind(current: BindingMap, action: Action, code: string): BindingMap {
  const b = new Bindings(current);
  b.set(action, code);
  return b.toJSON();
}

// ---------------------------------------------------------------------------------------------------------------
// DOM helpers. Only the screen factories call these, from inside their functions. Nothing here runs at module load,
// so the pure part of this file stays testable in the node environment.
// ---------------------------------------------------------------------------------------------------------------

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined && className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// A tile: bold title (or value) over a muted line (legacy tile(), index.html:3301).
export function tileNode(title: string, sub: string): HTMLElement {
  const tile = h('div', 'scr-tile');
  tile.append(h('b', '', title), h('small', '', sub));
  return tile;
}

// A progress bar. The fill width is a percentage, and the track is a progressbar for assistive tech.
export function barNode(fraction: number, label: string, className = 'scr-bar'): HTMLElement {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  const track = h('div', className);
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', label);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(pct));
  const fill = h('i');
  fill.style.width = `${String(pct)}%`;
  track.append(fill);
  return track;
}

// Section label. Uppercase is allowed here because every label is three words or fewer (see screens.css).
export function sectionLabel(text: string): HTMLElement {
  return h('div', 'scr-lbl', text);
}

// The brand: 'Breach' over 'Protocol', with the second word in the accent colour (legacy .brand, index.html:262).
// It is the page heading of the menu, so it is an h1.
export function brandNode(): HTMLElement {
  const brand = h('h1', 'scr-brand');
  brand.append('Breach ', h('br'), h('span', '', 'Protocol'));
  return brand;
}

// A nav button. Primary buttons take the amber fill. The arrow is decorative, as in the legacy menus.
export function navButton(
  label: string,
  primary: boolean,
  arrow: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = h('button', primary ? 'scr-navbtn scr-navbtn--primary' : 'scr-navbtn');
  button.type = 'button';
  const mark = h('span', 'scr-arrow', arrow);
  mark.setAttribute('aria-hidden', 'true');
  button.append(h('span', '', label), mark);
  button.addEventListener('click', onClick);
  return button;
}

// The screen frame: a hidden full-screen root with the two-column shell (nav and content).
export function screenRoot(name: string, nav: HTMLElement, content: HTMLElement): HTMLElement {
  const root = h('div', 'scr');
  root.dataset.screen = name;
  root.hidden = true;
  const shell = h('div', 'scr-shell');
  shell.append(nav, content);
  root.append(shell);
  return root;
}

// Escape goes back. It is taken in the capture phase, so the focus scope's own Escape handler (focus.ts) does not
// also run for these screens. While blocked() is true (a key is being rebound) the press is left alone.
export function bindEscape(onEscape: () => void, blocked: () => boolean = () => false): () => void {
  const listener = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || blocked()) return;
    event.preventDefault();
    event.stopPropagation();
    onEscape();
  };
  document.addEventListener('keydown', listener, true);
  return () => {
    document.removeEventListener('keydown', listener, true);
  };
}
