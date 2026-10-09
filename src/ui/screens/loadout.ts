// Mission setup (legacy #loadout, index.html:311-334). Each choice is saved to bp_loadout as it is made. Done and
// Escape return to the menu. Option grids use a roving tabindex: arrow keys move focus, and in the single-choice
// grids they also select (radio behaviour). The gadget grid is multi-select: arrows move focus, Enter or Space toggles.
import { DIFF } from '../../content/difficulty';
import { GADGETS } from '../../content/gadgets';
import {
  ATTACHMENT_IDS,
  DIFFICULTY_IDS,
  GADGET_IDS,
  MAP_IDS,
  PERK_IDS,
  PRIMARY_WEAPON_IDS,
  type DifficultyId,
  type GadgetId,
  type MapId,
} from '../../content/ids';
import { getMap, MAP_DESCRIPTIONS } from '../../content/maps';
import { WEAPONS } from '../../content/weapons';
import { rovingIndex } from '../focus';
import { saveLoadout } from '../../persist/store';
import type { Loadout } from '../../persist/schema';
import type { ScreenHandle } from '../contracts';
import {
  ATTACHMENT_INFO,
  GADGET_LIMIT,
  PERK_INFO,
  PRIMARY_DESC,
  bindEscape,
  h,
  loadoutGadgetToggle,
  navButton,
  primaryBars,
  screenRoot,
  sectionLabel,
  type FocusLike,
  type StatBar,
} from './model';

export interface LoadoutOptions {
  loadout: Loadout;
  onDone: () => void;
  focus?: FocusLike;
}

export interface LoadoutScreen extends ScreenHandle {
  readonly element: HTMLElement;
  // Replaces the shown loadout (for example after the store was changed elsewhere) and redraws the selection.
  refresh(next?: Loadout): void;
}

interface OptionText {
  title: string;
  sub: string;
  // Optional extra content inside the card (the primary weapon's stat bars).
  extra?: HTMLElement;
}

interface GroupSpec<T extends string> {
  label: string;
  columns: 2 | 3;
  multi: boolean;
  ids: readonly T[];
  describe: (id: T) => OptionText;
  isOn: (id: T) => boolean;
  pick: (id: T) => void;
}

interface OptionGroup {
  grid: HTMLElement;
  sync(): void;
}

function optionGroup<T extends string>(spec: GroupSpec<T>): OptionGroup {
  const buttons: HTMLButtonElement[] = [];
  // Index of the item with tabindex 0. Single-choice groups follow the selection. Multi groups keep the last item used.
  let stop = 0;

  const grid = h('div', `scr-grid scr-grid--${String(spec.columns)}`);
  grid.setAttribute('role', spec.multi ? 'group' : 'radiogroup');
  grid.setAttribute('aria-label', spec.label);

  spec.ids.forEach((id, index) => {
    const info = spec.describe(id);
    const button = h('button', 'scr-opt');
    button.type = 'button';
    if (!spec.multi) button.setAttribute('role', 'radio');
    button.append(h('b', '', info.title), h('small', '', info.sub));
    if (info.extra !== undefined) button.append(info.extra);

    button.addEventListener('click', () => {
      stop = index;
      spec.pick(id);
    });
    button.addEventListener('keydown', (event) => {
      const next = rovingIndex(spec.ids.length, index, event.key);
      if (next === index) return;
      event.preventDefault();
      const target = spec.ids[next];
      stop = next;
      buttons[next]?.focus();
      if (!spec.multi && target !== undefined) spec.pick(target);
      else sync();
    });
    buttons.push(button);
    grid.append(button);
  });

  function sync(): void {
    if (!spec.multi) {
      const selected = spec.ids.findIndex((id) => spec.isOn(id));
      stop = selected >= 0 ? selected : 0;
    }
    spec.ids.forEach((id, i) => {
      const button = buttons[i];
      if (button === undefined) return;
      const on = spec.isOn(id);
      if (spec.multi) button.setAttribute('aria-pressed', String(on));
      else button.setAttribute('aria-checked', String(on));
      button.tabIndex = i === stop ? 0 : -1;
    });
  }

  return { grid, sync };
}

function barsNode(bars: readonly StatBar[]): HTMLElement {
  const wrap = h('span', 'scr-sbars');
  for (const bar of bars) {
    const track = h('span', 'scr-sbar');
    const fill = h('i');
    fill.style.width = `${String(bar.pct)}%`;
    track.append(fill);
    wrap.append(h('span', '', bar.label), track);
  }
  return wrap;
}

export function createLoadoutScreen(opts: LoadoutOptions): LoadoutScreen {
  let loadout = opts.loadout;
  let visible = false;
  let unbindEscape: (() => void) | null = null;

  const done = navButton('Done', true, '›', () => {
    opts.onDone();
  });

  const brand = h('h1', 'scr-brand');
  brand.append('Mission ', h('br'), h('span', '', 'setup'));
  const nav = h('nav', 'scr-nav');
  nav.setAttribute('aria-label', 'Mission setup');
  nav.append(
    brand,
    h('p', 'scr-sub', 'Choose your kit. Attachments and perks apply to your primary weapon.'),
    h('div', 'scr-grow'),
    done,
  );

  // Commit a change: save it to bp_loadout, then redraw every group so the selection and tab stops follow it.
  function commit(): void {
    saveLoadout(loadout);
    syncAll();
  }

  const groups: OptionGroup[] = [];
  const addGroup = <T extends string>(spec: GroupSpec<T>): void => {
    const group = optionGroup(spec);
    groups.push(group);
    content.append(sectionLabel(spec.label), group.grid);
  };

  const content = h('section', 'scr-content');

  addGroup({
    label: 'Primary weapon',
    columns: 2,
    multi: false,
    ids: PRIMARY_WEAPON_IDS,
    describe: (id) => ({
      title: WEAPONS[id].name,
      sub: PRIMARY_DESC[id],
      extra: barsNode(primaryBars(id)),
    }),
    isOn: (id) => loadout.primary === id,
    pick: (id) => {
      loadout = { ...loadout, primary: id };
      commit();
    },
  });

  addGroup({
    label: 'Attachment',
    columns: 2,
    multi: false,
    ids: ATTACHMENT_IDS,
    describe: (id) => ({ title: ATTACHMENT_INFO[id].name, sub: ATTACHMENT_INFO[id].desc }),
    isOn: (id) => loadout.attachment === id,
    pick: (id) => {
      loadout = { ...loadout, attachment: id };
      commit();
    },
  });

  addGroup({
    label: 'Perk',
    columns: 2,
    multi: false,
    ids: PERK_IDS,
    describe: (id) => ({ title: PERK_INFO[id].name, sub: PERK_INFO[id].desc }),
    isOn: (id) => loadout.perk === id,
    pick: (id) => {
      loadout = { ...loadout, perk: id };
      commit();
    },
  });

  addGroup<GadgetId>({
    label: 'Gadgets (pick 2)',
    columns: 2,
    multi: true,
    ids: GADGET_IDS,
    describe: (id) => ({
      title: `${GADGETS[id].name} ×${String(GADGETS[id].uses)}`,
      sub: GADGETS[id].desc,
    }),
    isOn: (id) => loadout.gadgets.includes(id),
    pick: (id) => {
      // A removal that would leave fewer than two gadgets is ignored: the loadout always holds two.
      const next = loadoutGadgetToggle(loadout.gadgets, id);
      if (next.length !== GADGET_LIMIT) return;
      const first = next[0];
      const second = next[1];
      if (first === undefined || second === undefined) return;
      loadout = { ...loadout, gadgets: [first, second] };
      commit();
    },
  });

  addGroup<MapId>({
    label: 'Map',
    columns: 2,
    multi: false,
    ids: MAP_IDS,
    describe: (id) => ({ title: getMap(id).name, sub: MAP_DESCRIPTIONS[id] }),
    isOn: (id) => loadout.map === id,
    pick: (id) => {
      loadout = { ...loadout, map: id };
      commit();
    },
  });

  addGroup<DifficultyId>({
    label: 'Difficulty',
    columns: 3,
    multi: false,
    ids: DIFFICULTY_IDS,
    describe: (id) => ({ title: DIFF[id].name, sub: DIFF[id].desc }),
    isOn: (id) => loadout.difficulty === id,
    pick: (id) => {
      loadout = { ...loadout, difficulty: id };
      commit();
    },
  });

  const root = screenRoot('loadout', nav, content);

  function syncAll(): void {
    for (const group of groups) group.sync();
  }

  function show(): void {
    if (visible) return;
    root.hidden = false;
    visible = true;
    unbindEscape = bindEscape(() => {
      opts.onDone();
    });
    opts.focus?.activate();
    done.focus();
    syncAll();
  }

  function hide(): void {
    root.hidden = true;
    visible = false;
    unbindEscape?.();
    unbindEscape = null;
    opts.focus?.deactivate();
  }

  function refresh(next?: Loadout): void {
    if (next !== undefined) loadout = next;
    syncAll();
  }

  syncAll();
  return {
    id: 'loadout',
    element: root,
    get visible() {
      return visible;
    },
    show,
    hide,
    refresh,
  };
}
