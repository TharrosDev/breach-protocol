// Debrief (legacy #end, index.html:397-414). Shown when a match ends. The caller passes the result with present(),
// which renders it and shows the screen. Redeploy starts a new match. Main menu, and Escape, leave for the menu.
import type { ScreenHandle } from '../contracts';
import {
  bindEscape,
  debriefHeading,
  h,
  navButton,
  screenRoot,
  scoreLineSample,
  sectionLabel,
  tileNode,
  tileValues,
  type DebriefInput,
  type FocusLike,
} from './model';

export interface DebriefOptions {
  onRedeploy: () => void;
  onMenu: () => void;
  focus?: FocusLike;
}

export interface DebriefScreen extends ScreenHandle {
  readonly element: HTMLElement;
  // Renders the result and shows the screen.
  present(result: DebriefInput): void;
}

export function createDebriefScreen(opts: DebriefOptions): DebriefScreen {
  let visible = false;
  let unbindEscape: (() => void) | null = null;

  const redeploy = navButton('Redeploy', true, '›', () => {
    opts.onRedeploy();
  });
  const menu = navButton('Main menu', false, '‹', () => {
    opts.onMenu();
  });

  const label = sectionLabel('Debrief');
  const heading = h('h1', 'scr-brand');
  const score = h('p', 'scr-sub');
  const nav = h('nav', 'scr-nav');
  nav.setAttribute('aria-label', 'Debrief');
  nav.append(label, heading, score, h('div', 'scr-grow'), redeploy, menu);

  const performance = h('div', 'scr-tiles scr-tiles--big');
  const zones = h('div', 'scr-tiles');
  const content = h('section', 'scr-content');
  content.append(sectionLabel('Performance'), performance, sectionLabel('Objectives'), zones);

  const root = screenRoot('debrief', nav, content);

  function render(result: DebriefInput): void {
    heading.textContent = debriefHeading(result.win);
    score.textContent = scoreLineSample(result);
    performance.replaceChildren(
      ...tileValues({
        kills: result.kills,
        deaths: result.deaths,
        score: result.score,
        shots: result.shots,
        hits: result.hits,
        seconds: result.seconds,
        streak: result.streak,
      }).map((t) => tileNode(t.value, t.label)),
    );
    zones.replaceChildren(
      ...result.zones.map((z) => tileNode(z.name, z.captured ? 'Secured' : 'Not secured')),
    );
  }

  function show(): void {
    if (visible) return;
    root.hidden = false;
    visible = true;
    unbindEscape = bindEscape(() => {
      opts.onMenu();
    });
    opts.focus?.activate();
    redeploy.focus();
  }

  function hide(): void {
    root.hidden = true;
    visible = false;
    unbindEscape?.();
    unbindEscape = null;
    opts.focus?.deactivate();
  }

  function present(result: DebriefInput): void {
    render(result);
    show();
  }

  return {
    id: 'debrief',
    element: root,
    get visible() {
      return visible;
    },
    show,
    hide,
    present,
  };
}
