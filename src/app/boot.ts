import { getMap, MAP_DESCRIPTIONS } from '../content/maps';
import { loadLoadout } from '../persist/store';
import { detectCapabilities } from './capabilities';
import { startGame } from './game';
import './shell.css';

export function boot(root: HTMLElement): void {
  const caps = detectCapabilities();
  root.replaceChildren(caps.webgl2 ? menuScreen(root) : webglMessage());
}

// Two steps: Deploy shows the mission brief, and Launch mission starts the match.
function menuScreen(root: HTMLElement): HTMLElement {
  const main = el('main', 'shell');
  main.append(el('h1', 'title', 'Breach Protocol'));
  const deploy = el('button', 'primary', 'Deploy');
  deploy.addEventListener('click', () => {
    root.replaceChildren(briefScreen(root));
  });
  main.append(deploy, el('p', 'note', 'Rebuild in progress. The original game is at /legacy/.'));
  return main;
}

function briefScreen(root: HTMLElement): HTMLElement {
  const main = el('main', 'shell');
  main.append(el('h1', 'title', 'Mission brief'));
  // The map comes from the saved loadout, the same one startGame reads.
  const mapId = loadLoadout().map;
  main.append(
    el(
      'p',
      'note',
      `${getMap(mapId).name}. ${MAP_DESCRIPTIONS[mapId]} Move, slide, jump and vault, then fire at the dummy targets. Pointer lock is requested when the mission starts.`,
    ),
  );
  const launch = el('button', 'primary', 'Launch mission');
  launch.addEventListener('click', () => {
    const debug = new URLSearchParams(location.search).has('debug');
    startGame(root, {
      debug,
      onMenu: () => {
        boot(root);
      },
    });
  });
  const back = el('button', 'secondary', 'Back');
  back.addEventListener('click', () => {
    boot(root);
  });
  main.append(launch, back);
  return main;
}

function webglMessage(): HTMLElement {
  const main = el('main', 'shell');
  main.append(el('h1', 'title', 'WebGL 2 is required'));
  main.append(
    el(
      'p',
      'note',
      'This game needs WebGL 2. Update your graphics drivers, or open the page in Chrome, Edge or Firefox.',
    ),
  );
  const retry = el('button', 'primary', 'Retry');
  retry.addEventListener('click', () => {
    location.reload();
  });
  main.append(retry);
  return main;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
