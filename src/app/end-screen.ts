// The debrief shown when a match ends. Phase 4 minimal form: the result heading, the score sentence from the sim
// (formatScoreLine, index.html:2649), and two controls. The full debrief with tiles is Phase 5 (index.html:396-412).
import { formatScoreLine, type MatchResult } from '../sim/match';

export interface EndScreenActions {
  // Starts a new match on a new map layout (legacy Redeploy, index.html:3041).
  onRedeploy: () => void;
  // Leaves the match for the main menu (legacy endMenu, index.html:3043).
  onMenu: () => void;
}

// Legacy headings (index.html:2648).
export function debriefHeading(win: boolean): string {
  return win ? 'Sector Secured' : 'Mission Failed';
}

// The outer element is the full-screen backdrop (.end-screen). The inner main is the shell column.
export function buildEndScreen(result: MatchResult, actions: EndScreenActions): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'end-screen';
  const main = document.createElement('main');
  main.className = 'shell';
  main.append(
    el('h1', 'title', debriefHeading(result.win)),
    el('p', 'note', formatScoreLine(result)),
    button('primary', 'Redeploy', actions.onRedeploy),
    button('secondary', 'Main menu', actions.onMenu),
  );
  screen.append(main);
  return screen;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
