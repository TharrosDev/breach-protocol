// Mission brief (legacy #brief, index.html:291-309). Shows the map, its objectives, the win conditions and the
// loadout that will be used. Launch mission starts the match. Back returns to the menu. Escape goes back.
import { DIFF } from '../../content/difficulty';
import { getMap, MAP_DESCRIPTIONS } from '../../content/maps';
import { ZONE_TICKET_COST } from '../../content/tuning';
import type { Loadout } from '../../persist/schema';
import type { ScreenHandle } from '../contracts';
import {
  bindEscape,
  h,
  loadoutTiles,
  navButton,
  screenRoot,
  sectionLabel,
  tileNode,
  winConditionText,
  type FocusLike,
} from './model';

export interface BriefOptions {
  loadout: Loadout;
  onLaunch: () => void;
  onBack: () => void;
  focus?: FocusLike;
}

export interface BriefScreen extends ScreenHandle {
  readonly element: HTMLElement;
  // Re-renders for a new loadout (the map, difficulty and gadgets may have changed in the loadout screen).
  refresh(next?: Loadout): void;
}

export function createBriefScreen(opts: BriefOptions): BriefScreen {
  let loadout = opts.loadout;
  let visible = false;
  let unbindEscape: (() => void) | null = null;

  const launch = navButton('Launch mission', true, '›', () => {
    opts.onLaunch();
  });
  const back = navButton('Back', false, '‹', () => {
    opts.onBack();
  });

  const label = sectionLabel('Mission brief');
  const name = h('h1', 'scr-brand');
  const description = h('p', 'scr-sub');
  const nav = h('nav', 'scr-nav');
  nav.setAttribute('aria-label', 'Mission brief');
  nav.append(label, name, description, h('div', 'scr-grow'), launch, back);

  const zones = h('div', 'scr-tiles');
  const win = h('p', 'scr-card');
  const loadoutTilesNode = h('div', 'scr-tiles');
  const content = h('section', 'scr-content');
  content.append(
    sectionLabel('Objectives'),
    zones,
    sectionLabel('Win conditions'),
    win,
    sectionLabel('Your loadout'),
    loadoutTilesNode,
  );

  const root = screenRoot('brief', nav, content);

  function render(): void {
    const map = getMap(loadout.map);
    const df = DIFF[loadout.difficulty];
    name.textContent = map.name;
    description.textContent = MAP_DESCRIPTIONS[loadout.map];
    zones.replaceChildren(...map.zones.map((z) => tileNode(z.name, 'Hold it to capture')));
    win.textContent = winConditionText(map.zones.length, df.tickets, df.lives, ZONE_TICKET_COST);
    loadoutTilesNode.replaceChildren(...loadoutTiles(loadout).map((t) => tileNode(t.title, t.sub)));
  }

  function show(): void {
    if (visible) return;
    root.hidden = false;
    visible = true;
    unbindEscape = bindEscape(() => {
      opts.onBack();
    });
    opts.focus?.activate();
    launch.focus();
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
    render();
  }

  render();
  return {
    id: 'brief',
    element: root,
    get visible() {
      return visible;
    },
    show,
    hide,
    refresh,
  };
}
