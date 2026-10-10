// Debrief (legacy #end, index.html:397-414). Shown when a match ends. The caller passes the result with present(),
// which renders it and shows the screen. Redeploy starts a new match. Main menu, and Escape, leave for the menu.
// When the match earned progress, the debrief also shows the XP breakdown, rank-ups, new unlocks, challenge progress,
// medals and weapon mastery.
import type { ScreenHandle } from '../contracts';
import { MEDALS } from '../../content/progression';
import { WEAPONS } from '../../content/weapons';
import type { MatchReport } from '../../progress/career';
import {
  bindEscape,
  barNode,
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
import { formatInt, unlockTile } from './career-model';
import { progressRow } from './career';
import { rankTitle } from '../../content/progression';

export interface DebriefOptions {
  onRedeploy: () => void;
  onMenu: () => void;
  focus?: FocusLike;
}

export interface DebriefScreen extends ScreenHandle {
  readonly element: HTMLElement;
  // Renders the result and shows the screen. The report is the progress the match earned, when there is one.
  present(result: DebriefInput, report?: MatchReport | null): void;
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
  const progress = h('div', 'scr-progress');
  const content = h('section', 'scr-content');
  content.append(sectionLabel('Performance'), performance, sectionLabel('Objectives'), zones, progress);

  const root = screenRoot('debrief', nav, content);

  function renderProgress(report: MatchReport | null | undefined): void {
    if (report === null || report === undefined) {
      progress.replaceChildren();
      return;
    }
    const nodes: HTMLElement[] = [];

    // XP: one line per source, the total, and the rank bar.
    nodes.push(sectionLabel('Experience'));
    const lines = h('div', 'scr-xplines');
    for (const l of report.lines) {
      const row = h('div', 'scr-xpline');
      row.append(h('span', '', l.label), h('b', '', `${l.xp > 0 ? '+' : ''}${formatInt(l.xp)}`));
      lines.append(row);
    }
    const total = h('div', 'scr-xpline scr-xpline--total');
    total.append(h('span', '', 'Total'), h('b', '', `+${formatInt(report.xp)} XP`));
    lines.append(total);
    nodes.push(lines);

    const rankUp = report.rankAfter > report.rankBefore;
    const rankCard = h('div', 'scr-card scr-rankcard');
    const heading2 = h(
      'p',
      'scr-rank-heading',
      rankUp
        ? `Rank up: ${String(report.rankBefore)} to ${String(report.rankAfter)} · ${rankTitle(report.rankAfter)}`
        : `Rank ${String(report.rankAfter)} · ${rankTitle(report.rankAfter)}`,
    );
    rankCard.append(
      heading2,
      barNode(report.maxed ? 1 : report.fractionAfter, 'Experience to the next rank', 'scr-bar scr-bar--xp'),
    );
    nodes.push(rankCard);

    if (report.unlocks.length > 0) {
      nodes.push(sectionLabel('New unlocks'));
      const tiles = h('div', 'scr-tiles');
      for (const u of report.unlocks) {
        const t = unlockTile(u);
        tiles.append(tileNode(t.title, t.sub));
      }
      nodes.push(tiles);
    }

    if (report.challenges.length > 0) {
      nodes.push(sectionLabel('Daily challenges'));
      const list = h('div', 'scr-plist');
      for (const c of report.challenges) {
        const sub = c.justDone
          ? `Completed · +${formatInt(c.xp)} XP`
          : c.done
            ? 'Complete'
            : `${formatInt(c.progress)} / ${formatInt(c.target)} · +${formatInt(c.xp)} XP`;
        list.append(progressRow(c.text, sub, c.progress / c.target, c.text, c.done));
      }
      nodes.push(list);
    }

    if (report.medals.length > 0) {
      nodes.push(sectionLabel('Medals'));
      const tiles = h('div', 'scr-tiles');
      for (const m of report.medals) tiles.append(tileNode(MEDALS[m].name, MEDALS[m].desc));
      nodes.push(tiles);
    }

    if (report.masteryUps.length > 0) {
      nodes.push(sectionLabel('Weapon mastery'));
      const tiles = h('div', 'scr-tiles');
      for (const m of report.masteryUps) {
        tiles.append(tileNode(WEAPONS[m.weapon].name, `Mastery level ${String(m.level)}`));
      }
      nodes.push(tiles);
    }
    progress.replaceChildren(...nodes);
  }

  function render(result: DebriefInput, report?: MatchReport | null): void {
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
    renderProgress(report);
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

  function present(result: DebriefInput, report?: MatchReport | null): void {
    render(result, report);
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
