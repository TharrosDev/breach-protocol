// Pause (legacy #pause, index.html:381-395). Resume and Escape continue the match. Settings opens the settings
// screen, and the caller returns here when it closes. Abort to menu ends the match.
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
  type FocusLike,
} from './model';

export interface PauseOptions {
  loadout: Loadout;
  onResume: () => void;
  onSettings: () => void;
  onAbort: () => void;
  focus?: FocusLike;
}

export interface PauseScreen extends ScreenHandle {
  readonly element: HTMLElement;
  refresh(next?: Loadout): void;
}

export function createPauseScreen(opts: PauseOptions): PauseScreen {
  let loadout = opts.loadout;
  let visible = false;
  let unbindEscape: (() => void) | null = null;

  const resume = navButton('Resume', true, '›', () => {
    opts.onResume();
  });
  const settings = navButton('Settings', false, '›', () => {
    opts.onSettings();
  });
  const abort = navButton('Abort to menu', false, '‹', () => {
    opts.onAbort();
  });

  const nav = h('nav', 'scr-nav');
  nav.setAttribute('aria-label', 'Paused');
  nav.append(
    h('h1', 'scr-brand', 'Paused'),
    h('p', 'scr-sub', 'Hostiles are still moving.'),
    resume,
    settings,
    abort,
  );

  const tiles = h('div', 'scr-tiles');
  const content = h('section', 'scr-content');
  content.append(sectionLabel('Current loadout'), tiles);

  const root = screenRoot('pause', nav, content);

  function render(): void {
    tiles.replaceChildren(...loadoutTiles(loadout).map((t) => tileNode(t.title, t.sub)));
  }

  function show(): void {
    if (visible) return;
    root.hidden = false;
    visible = true;
    // Escape resumes, as the legacy pause overlay did.
    unbindEscape = bindEscape(() => {
      opts.onResume();
    });
    opts.focus?.activate();
    resume.focus();
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
    id: 'pause',
    element: root,
    get visible() {
      return visible;
    },
    show,
    hide,
    refresh,
  };
}
