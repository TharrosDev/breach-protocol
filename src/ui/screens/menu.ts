// Main menu (legacy #menu, index.html:256-289). Deploy opens the mission brief. Mission setup and Settings open
// their screens. The loadout tiles and the Controls list read the live loadout and bindings.
import type { ScreenHandle } from '../contracts';
import type { Loadout } from '../../persist/schema';
import {
  brandNode,
  controlRows,
  h,
  keyLabel,
  loadoutTiles,
  navButton,
  screenRoot,
  sectionLabel,
  tileNode,
  type BindingMap,
  type ControlRow,
  type FocusLike,
} from './model';

export interface MenuOptions {
  loadout: Loadout;
  bindings: BindingMap;
  onDeploy: () => void;
  onLoadout: () => void;
  onSettings: () => void;
  // Turns a KeyboardEvent.code into the label on a key cap. Defaults to keyLabel.
  keyName?: (code: string) => string;
  focus?: FocusLike;
}

export interface MenuScreen extends ScreenHandle {
  // The screen root. The caller appends it to the page once; show() and hide() toggle its hidden attribute.
  readonly element: HTMLElement;
  // Re-renders the loadout tiles and the key labels. Pass the values that changed, or nothing to redraw.
  refresh(next?: { loadout?: Loadout; bindings?: BindingMap }): void;
}

export function createMenuScreen(opts: MenuOptions): MenuScreen {
  const keyName = opts.keyName ?? keyLabel;
  let loadout = opts.loadout;
  let bindings = opts.bindings;
  let visible = false;

  const deploy = navButton('Deploy', true, '›', () => {
    opts.onDeploy();
  });
  const mission = navButton('Mission setup', false, '›', () => {
    opts.onLoadout();
  });
  const settings = navButton('Settings', false, '›', () => {
    opts.onSettings();
  });

  const nav = h('nav', 'scr-nav');
  nav.setAttribute('aria-label', 'Main menu');
  nav.append(
    brandNode(),
    h('p', 'scr-sub', 'Hold the sector. Secure every objective before your reinforcements run out.'),
    deploy,
    mission,
    settings,
    h('div', 'scr-grow'),
    h('p', 'scr-hint', 'Best played in Chrome or Edge with a mouse.'),
  );

  const tiles = h('div', 'scr-tiles');
  const keys = h('div', 'scr-keys');
  const content = h('section', 'scr-content');
  content.append(sectionLabel('Current loadout'), tiles, sectionLabel('Controls'), keys);

  const root = screenRoot('menu', nav, content);

  function render(): void {
    tiles.replaceChildren(...loadoutTiles(loadout).map((t) => tileNode(t.title, t.sub)));
    keys.replaceChildren(...keyRowNodes(controlRows(bindings, keyName)));
  }

  function show(): void {
    root.hidden = false;
    visible = true;
    opts.focus?.activate();
    deploy.focus();
  }

  function hide(): void {
    root.hidden = true;
    visible = false;
    opts.focus?.deactivate();
  }

  function refresh(next?: { loadout?: Loadout; bindings?: BindingMap }): void {
    if (next?.loadout !== undefined) loadout = next.loadout;
    if (next?.bindings !== undefined) bindings = next.bindings;
    render();
  }

  render();
  return {
    id: 'menu',
    element: root,
    get visible() {
      return visible;
    },
    show,
    hide,
    refresh,
  };
}

// Each row is a key cell (one or two key caps) and its text, as two grid children (index.html:265-287).
function keyRowNodes(rows: readonly ControlRow[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const row of rows) {
    const cell = h('span', 'scr-kc');
    row.keys.forEach((key, i) => {
      if (i > 0) cell.append(' ');
      cell.append(h('kbd', '', key));
    });
    out.push(cell, h('span', '', row.text));
  }
  return out;
}
