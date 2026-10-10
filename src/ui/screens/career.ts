// Career (Stats) screen: rank and XP, lifetime stats, weapon mastery, today's challenges, medals and the next unlocks.
// Reached from the main menu. Back and Escape return to the menu.
import type { ScreenHandle } from '../contracts';
import type { Profile } from '../../persist/profile';
import {
  bindEscape,
  barNode,
  h,
  navButton,
  screenRoot,
  sectionLabel,
  tileNode,
  type FocusLike,
} from './model';
import {
  careerTiles,
  challengeRows,
  formatInt,
  masteryRows,
  medalRows,
  nextUnlocks,
  rankView,
  unlockTile,
  type ChallengeRow,
  type MasteryRow,
} from './career-model';

export interface CareerOptions {
  profile: Profile;
  // Local date key (YYYY-MM-DD), so the challenge list matches the stored progress.
  day: () => string;
  onBack: () => void;
  focus?: FocusLike;
}

export interface CareerScreen extends ScreenHandle {
  readonly element: HTMLElement;
  refresh(next?: Profile): void;
}

// A row with a title, a muted line and a progress bar (mastery and challenges).
export function progressRow(
  title: string,
  sub: string,
  fraction: number,
  barLabel: string,
  done = false,
): HTMLElement {
  const row = h('div', done ? 'scr-prow scr-prow--done' : 'scr-prow');
  const head = h('div', 'scr-prow-head');
  head.append(h('b', '', title), h('small', '', sub));
  row.append(head, barNode(fraction, barLabel));
  return row;
}

function masteryNode(row: MasteryRow): HTMLElement {
  return progressRow(row.name, row.text, row.fraction, `${row.name} mastery`);
}

function challengeNode(row: ChallengeRow): HTMLElement {
  const sub = row.done
    ? `Complete · +${formatInt(row.xp)} XP`
    : `${formatInt(row.progress)} / ${formatInt(row.target)} · +${formatInt(row.xp)} XP`;
  return progressRow(row.text, sub, row.fraction, row.text, row.done);
}

export function createCareerScreen(opts: CareerOptions): CareerScreen {
  let profile = opts.profile;
  let visible = false;
  let unbindEscape: (() => void) | null = null;

  const back = navButton('Back', true, '‹', () => {
    opts.onBack();
  });

  const heading = h('p', 'scr-rank-heading');
  let xpBar: HTMLElement = h('div');
  const xpText = h('small', 'scr-rank-xp');
  const rankBox = h('div', 'scr-rank');
  rankBox.append(heading, xpBar, xpText);

  const brand = h('h1', 'scr-brand', 'Career');
  const nav = h('nav', 'scr-nav');
  nav.setAttribute('aria-label', 'Career');
  nav.append(brand, rankBox, h('div', 'scr-grow'), back);

  const lifetime = h('div', 'scr-tiles');
  const mastery = h('div', 'scr-plist');
  const challenges = h('div', 'scr-plist');
  const medals = h('div', 'scr-tiles');
  const unlocks = h('div', 'scr-tiles');
  const content = h('section', 'scr-content');
  content.append(
    sectionLabel('Lifetime'),
    lifetime,
    sectionLabel('Daily challenges'),
    challenges,
    sectionLabel('Weapon mastery'),
    mastery,
    sectionLabel('Medals'),
    medals,
    sectionLabel('Next unlocks'),
    unlocks,
  );

  const root = screenRoot('career', nav, content);

  function render(): void {
    const view = rankView(profile.xp);
    heading.textContent = view.heading;
    const bar = barNode(view.info.fraction, 'Experience to the next rank', 'scr-bar scr-bar--xp');
    xpBar.replaceWith(bar);
    xpBar = bar;
    xpText.textContent = `${view.xpText} · ${formatInt(profile.xp)} total`;
    lifetime.replaceChildren(...careerTiles(profile).map((t) => tileNode(t.title, t.sub)));
    challenges.replaceChildren(...challengeRows(profile, opts.day()).map(challengeNode));
    mastery.replaceChildren(...masteryRows(profile).map(masteryNode));
    medals.replaceChildren(
      ...medalRows(profile).map((m) => {
        const tile = tileNode(m.name, m.count > 0 ? `${m.desc} ×${formatInt(m.count)}` : m.desc);
        if (m.count === 0) tile.classList.add('scr-tile--dim');
        return tile;
      }),
    );
    const next = nextUnlocks(view.rank);
    unlocks.replaceChildren(
      ...(next.length > 0
        ? next.map((u) => {
            const t = unlockTile(u);
            return tileNode(t.title, t.sub);
          })
        : [tileNode('Everything unlocked', 'Max rank reached')]),
    );
  }

  function show(): void {
    if (visible) return;
    render();
    root.hidden = false;
    visible = true;
    unbindEscape = bindEscape(() => {
      opts.onBack();
    });
    opts.focus?.activate();
    back.focus();
  }

  function hide(): void {
    root.hidden = true;
    visible = false;
    unbindEscape?.();
    unbindEscape = null;
    opts.focus?.deactivate();
  }

  function refresh(next?: Profile): void {
    if (next !== undefined) profile = next;
    render();
  }

  render();
  return {
    id: 'career',
    element: root,
    get visible() {
      return visible;
    },
    show,
    hide,
    refresh,
  };
}
