// Main menu (legacy #menu, index.html:256-289). Deploy opens the mission brief. Mission setup and Settings open
// their screens. The loadout tiles and the Controls list read the live loadout and bindings.
import type { ScreenHandle } from '../contracts';
import type { Loadout } from '../../persist/schema';
import type { Profile } from '../../persist/profile';
import {
  barNode,
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
import { challengeRows, formatInt, rankView } from './career-model';
import { progressRow } from './career';

export interface MenuOptions {
  loadout: Loadout;
  bindings: BindingMap;
  profile: Profile;
  // Local date key (YYYY-MM-DD) for the daily challenges.
  day: () => string;
  onCareer: () => void;
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
  refresh(next?: { loadout?: Loadout; bindings?: BindingMap; profile?: Profile }): void;
}

export function createMenuScreen(opts: MenuOptions): MenuScreen {
  const keyName = opts.keyName ?? keyLabel;
  let loadout = opts.loadout;
  let bindings = opts.bindings;
  let profile = opts.profile;
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

  const career = navButton('Career', false, '›', () => {
    opts.onCareer();
  });

  const rankHeading = h('p', 'scr-rank-heading');
  let xpBar: HTMLElement = h('div');
  const xpText = h('small', 'scr-rank-xp');
  const rankBox = h('div', 'scr-rank');
  rankBox.append(rankHeading, xpBar, xpText);

  const nav = h('nav', 'scr-nav');
  nav.setAttribute('aria-label', 'Main menu');
  nav.append(
    brandNode(),
    rankBox,
    h('p', 'scr-sub', 'Hold the sector. Secure every objective before your reinforcements run out.'),
    deploy,
    mission,
    settings,
    career,
    h('div', 'scr-grow'),
    h('p', 'scr-hint', 'Best played in Chrome or Edge with a mouse.'),
  );

  const tiles = h('div', 'scr-tiles');
  const daily = h('div', 'scr-plist');
  const keys = h('div', 'scr-keys');
  const content = h('section', 'scr-content');
  content.append(
    sectionLabel('Current loadout'),
    tiles,
    sectionLabel('Daily challenges'),
    daily,
    sectionLabel('Controls'),
    keys,
  );

  const root = screenRoot('menu', nav, content);

  function render(): void {
    tiles.replaceChildren(...loadoutTiles(loadout).map((t) => tileNode(t.title, t.sub)));
    const view = rankView(profile.xp);
    rankHeading.textContent = view.heading;
    const bar = barNode(view.info.fraction, 'Experience to the next rank', 'scr-bar scr-bar--xp');
    xpBar.replaceWith(bar);
    xpBar = bar;
    xpText.textContent = view.xpText;
    daily.replaceChildren(
      ...challengeRows(profile, opts.day()).map((c) =>
        progressRow(
          c.text,
          c.done
            ? `Complete · +${formatInt(c.xp)} XP`
            : `${formatInt(c.progress)} / ${formatInt(c.target)} · +${formatInt(c.xp)} XP`,
          c.fraction,
          c.text,
          c.done,
        ),
      ),
    );
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

  function refresh(next?: { loadout?: Loadout; bindings?: BindingMap; profile?: Profile }): void {
    if (next?.loadout !== undefined) loadout = next.loadout;
    if (next?.bindings !== undefined) bindings = next.bindings;
    if (next?.profile !== undefined) profile = next.profile;
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
