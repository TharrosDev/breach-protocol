// Settings (legacy #settings, index.html:336-379). Four tabs (Controls, Mouse, Display, Audio) sit on the left nav,
// and become a top bar at phone width. Every change is saved at once with saveSettings. Key rebinding saves with
// saveBindings. Back and Escape return to whichever screen opened settings (the caller decides).
import { ACTION_LABELS, DEFAULT_BINDINGS } from '../../content/bindingDefaults';
import { ACTIONS, type Action } from '../../content/ids';
import { YAW_PER_PX } from '../../content/tuning';
import {
  DEFAULT_SETTINGS,
  DPI_VALUES,
  validateDpi,
  validateQuality,
  type Settings,
} from '../../persist/schema';
import { saveBindings, saveSettings } from '../../persist/store';
import type { ScreenHandle } from '../contracts';
import { rovingIndex } from '../focus';
import {
  applyRebind,
  bindEscape,
  calcText,
  h,
  keyLabel,
  navButton,
  screenRoot,
  sectionLabel,
  type BindingMap,
  type FocusLike,
} from './model';

// The values after a change. Settings and bindings are both passed, so the caller can keep one copy of each.
export interface SettingsChange {
  readonly settings: Settings;
  readonly bindings: BindingMap;
}

export interface SettingsOptions {
  settings: Settings;
  bindings: BindingMap;
  onBack: () => void;
  // Called after every saved change (a slider, a checkbox, a rebind, a reset). The caller applies it live.
  onChange?: (next: SettingsChange) => void;
  // Turns a KeyboardEvent.code into the label on a key cap. Defaults to keyLabel.
  keyName?: (code: string) => string;
  focus?: FocusLike;
}

export interface SettingsScreen extends ScreenHandle {
  readonly element: HTMLElement;
  // Redraws every control. Pass the current values when they may have changed elsewhere (for example a quality
  // downgrade during a match); with no argument the screen keeps its own copy.
  refresh(next?: Partial<SettingsChange>): void;
}

type TabId = 'controls' | 'mouse' | 'display' | 'audio';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'controls', label: 'Controls' },
  { id: 'mouse', label: 'Mouse' },
  { id: 'display', label: 'Display' },
  { id: 'audio', label: 'Audio' },
];

const CAPTURE_PROMPT = 'press a key…';

interface RangeRow {
  row: HTMLElement;
  input: HTMLInputElement;
  output: HTMLOutputElement;
}

function rangeRow(text: string, min: number, max: number, step: number): RangeRow {
  const row = h('label', 'scr-row');
  const input = h('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  const output = h('output');
  const control = h('span', 'scr-ctl');
  control.append(input, ' ', output);
  row.append(h('span', '', text), control);
  return { row, input, output };
}

function checkRow(text: string): { row: HTMLElement; input: HTMLInputElement } {
  const row = h('label', 'scr-row');
  const input = h('input');
  input.type = 'checkbox';
  row.append(h('span', '', text), input);
  return { row, input };
}

export function createSettingsScreen(opts: SettingsOptions): SettingsScreen {
  const keyName = opts.keyName ?? keyLabel;
  let settings: Settings = { ...opts.settings };
  let bindings: BindingMap = { ...opts.bindings };
  let tab: TabId = 'controls';

  function notify(): void {
    opts.onChange?.({ settings: { ...settings }, bindings: { ...bindings } });
  }
  let capturing: Action | null = null;
  let visible = false;
  let unbindEscape: (() => void) | null = null;

  // Navigation.
  const tabButtons = new Map<TabId, HTMLButtonElement>();
  const tabList = h('div', 'scr-tabs');
  tabList.setAttribute('role', 'tablist');
  tabList.setAttribute('aria-orientation', 'vertical');
  tabList.setAttribute('aria-label', 'Settings sections');
  TABS.forEach((t, index) => {
    const button = h('button', 'scr-navbtn scr-tab', t.label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => {
      selectTab(t.id, false);
    });
    button.addEventListener('keydown', (event) => {
      const next = rovingIndex(TABS.length, index, event.key);
      if (next === index) return;
      event.preventDefault();
      const target = TABS[next];
      if (target !== undefined) selectTab(target.id, true);
    });
    tabButtons.set(t.id, button);
    tabList.append(button);
  });

  const reset = navButton('Reset defaults', false, '', () => {
    resetDefaults();
  });
  const back = navButton('Back', true, '‹', () => {
    opts.onBack();
  });

  const nav = h('nav', 'scr-nav');
  nav.setAttribute('aria-label', 'Settings');
  nav.append(h('h1', 'scr-brand', 'Settings'), tabList, h('div', 'scr-grow'), reset, back);

  // Controls pane: the 17 actions, each with its key cap button.
  const bindButtons = new Map<Action, HTMLButtonElement>();
  const bindList = h('div', 'scr-binds');
  for (const action of ACTIONS) {
    const button = h('button', 'scr-btn scr-btn--ghost');
    button.type = 'button';
    button.addEventListener('click', () => {
      startCapture(action);
    });
    bindButtons.set(action, button);
    bindList.append(h('div', 'scr-row', ACTION_LABELS[action]), button);
  }
  const resetKeys = h('button', 'scr-btn scr-btn--ghost', 'Reset keys');
  resetKeys.type = 'button';
  resetKeys.addEventListener('click', () => {
    resetBindings();
  });
  const keyStack = h('div', 'scr-stack');
  keyStack.append(resetKeys);

  // Mouse pane.
  const sens = rangeRow('Sensitivity', 0.1, 3, 0.05);
  sens.input.addEventListener('input', () => {
    apply({ sens: Number(sens.input.value) });
    sens.output.textContent = formatSens(settings.sens);
  });
  const ads = rangeRow('Aim-down-sights multiplier', 0.2, 1.2, 0.05);
  ads.input.addEventListener('input', () => {
    apply({ adsMul: Number(ads.input.value) });
    ads.output.textContent = formatPercent(settings.adsMul);
  });
  const dpi = h('select');
  for (const value of DPI_VALUES) {
    const option = h('option', '', String(value));
    option.value = String(value);
    dpi.append(option);
  }
  const dpiRow = h('label', 'scr-row');
  dpiRow.append(h('span', '', 'Mouse DPI (for the calculator)'), dpi);
  dpi.addEventListener('change', () => {
    const next = validateDpi(Number(dpi.value));
    if (next !== undefined) apply({ dpi: next });
  });
  const invert = checkRow('Invert vertical look');
  invert.input.addEventListener('change', () => {
    apply({ invertY: invert.input.checked });
  });
  // The calculator text (legacy updateCalc, index.html:2769-2776).
  const calcHip = h('span');
  const calcAds = h('span');
  const hipLine = h('p');
  hipLine.append(h('b', '', 'Turn 360° (hip)'), ': ', calcHip);
  const adsLine = h('p');
  adsLine.append(h('b', '', 'Aiming down sights'), ': ', calcAds);
  const calc = h('div', 'scr-calc');
  calc.append(hipLine, adsLine);

  // Display pane.
  const fov = rangeRow('Field of view', 60, 110, 1);
  fov.input.addEventListener('input', () => {
    apply({ fov: Number(fov.input.value) });
    fov.output.textContent = `${String(settings.fov)}°`;
  });
  const quality = h('select');
  for (const [value, label] of [
    ['high', 'High (shadows, lights, particles)'],
    ['low', 'Low (performance)'],
  ] as const) {
    const option = h('option', '', label);
    option.value = value;
    quality.append(option);
  }
  const qualityRow = h('label', 'scr-row');
  qualityRow.append(h('span', '', 'Graphics quality'), quality);
  quality.addEventListener('change', () => {
    const next = validateQuality(quality.value);
    if (next !== undefined) apply({ quality: next });
  });
  const fps = checkRow('Show FPS counter');
  fps.input.addEventListener('change', () => {
    apply({ showFps: fps.input.checked });
  });
  const shake = checkRow('Screen shake');
  shake.input.addEventListener('change', () => {
    apply({ shake: shake.input.checked });
  });
  const colourblind = checkRow('Colour-blind friendly colours (zones, HUD, markers)');
  colourblind.input.addEventListener('change', () => {
    apply({ colorblind: colourblind.input.checked });
  });

  // Audio pane.
  const volume = rangeRow('Master volume', 0, 1, 0.05);
  volume.input.addEventListener('input', () => {
    apply({ volume: Number(volume.input.value) });
    volume.output.textContent = formatPercent(settings.volume);
  });
  const mute = checkRow('Mute all sound');
  mute.input.addEventListener('change', () => {
    apply({ muted: mute.input.checked });
  });

  const panes = new Map<TabId, HTMLElement>();
  const makePane = (id: TabId, label: string, children: HTMLElement[]): HTMLElement => {
    const pane = h('div', 'scr-pane');
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-label', label);
    pane.append(...children);
    panes.set(id, pane);
    return pane;
  };

  const content = h('section', 'scr-content');
  content.append(
    makePane('controls', 'Controls', [
      sectionLabel('Keys'),
      h('p', 'scr-hint', 'Click a key, then press the new one. Press Esc to cancel.'),
      bindList,
      keyStack,
    ]),
    makePane('mouse', 'Mouse', [sectionLabel('Look'), sens.row, ads.row, dpiRow, invert.row, calc]),
    makePane('display', 'Display', [
      sectionLabel('Picture'),
      fov.row,
      qualityRow,
      fps.row,
      shake.row,
      colourblind.row,
    ]),
    makePane('audio', 'Audio', [sectionLabel('Sound'), volume.row, mute.row]),
  );

  const root = screenRoot('settings', nav, content);

  function selectTab(id: TabId, focus: boolean): void {
    tab = id;
    for (const t of TABS) {
      const button = tabButtons.get(t.id);
      const pane = panes.get(t.id);
      const selected = t.id === id;
      button?.setAttribute('aria-selected', String(selected));
      button?.setAttribute('tabindex', selected ? '0' : '-1');
      if (pane !== undefined) pane.hidden = !selected;
    }
    if (focus) tabButtons.get(id)?.focus();
  }

  function apply(patch: Partial<Settings>): void {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    renderCalc();
    notify();
  }

  function renderCalc(): void {
    const text = calcText(settings.sens, settings.dpi, settings.adsMul, YAW_PER_PX);
    calcHip.textContent = text.hip;
    calcAds.textContent = text.ads;
  }

  function syncSettingsInputs(): void {
    sens.input.value = String(settings.sens);
    sens.output.textContent = formatSens(settings.sens);
    ads.input.value = String(settings.adsMul);
    ads.output.textContent = formatPercent(settings.adsMul);
    dpi.value = String(settings.dpi);
    invert.input.checked = settings.invertY;
    fov.input.value = String(settings.fov);
    fov.output.textContent = `${String(settings.fov)}°`;
    quality.value = settings.quality;
    fps.input.checked = settings.showFps;
    shake.input.checked = settings.shake;
    colourblind.input.checked = settings.colorblind;
    volume.input.value = String(settings.volume);
    volume.output.textContent = formatPercent(settings.volume);
    mute.input.checked = settings.muted;
    renderCalc();
  }

  function renderBinds(): void {
    for (const action of ACTIONS) {
      const button = bindButtons.get(action);
      if (button === undefined) continue;
      button.textContent = capturing === action ? CAPTURE_PROMPT : keyName(bindings[action]);
    }
  }

  // Rebinding listens for the next key in the capture phase, so the key does not reach the game or the screen.
  function onCapture(event: KeyboardEvent): void {
    const action = capturing;
    if (action === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.code !== 'Escape' && event.code !== '') {
      bindings = applyRebind(bindings, action, event.code);
      saveBindings(bindings);
      notify();
    }
    endCapture();
  }

  function startCapture(action: Action): void {
    document.removeEventListener('keydown', onCapture, true);
    document.addEventListener('keydown', onCapture, true);
    capturing = action;
    renderBinds();
  }

  function endCapture(): void {
    document.removeEventListener('keydown', onCapture, true);
    capturing = null;
    renderBinds();
  }

  function resetBindings(): void {
    if (capturing !== null) endCapture();
    bindings = { ...DEFAULT_BINDINGS };
    saveBindings(bindings);
    renderBinds();
    notify();
  }

  function resetDefaults(): void {
    settings = { ...DEFAULT_SETTINGS };
    saveSettings(settings);
    syncSettingsInputs();
    notify();
  }

  function refresh(next?: Partial<SettingsChange>): void {
    if (next?.settings !== undefined) settings = { ...next.settings };
    if (next?.bindings !== undefined) bindings = { ...next.bindings };
    if (capturing !== null) endCapture();
    syncSettingsInputs();
    renderBinds();
  }

  function show(): void {
    if (visible) return;
    root.hidden = false;
    visible = true;
    unbindEscape = bindEscape(
      () => {
        opts.onBack();
      },
      () => capturing !== null,
    );
    refresh();
    selectTab(tab, false);
    opts.focus?.activate();
    tabButtons.get(tab)?.focus();
  }

  function hide(): void {
    if (capturing !== null) endCapture();
    root.hidden = true;
    visible = false;
    unbindEscape?.();
    unbindEscape = null;
    opts.focus?.deactivate();
  }

  // The first render, before the screen is shown.
  selectTab(tab, false);
  refresh();

  return {
    id: 'settings',
    element: root,
    get visible() {
      return visible;
    },
    show,
    hide,
    refresh,
  };
}

function formatSens(value: number): string {
  return value.toFixed(2);
}

function formatPercent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}
