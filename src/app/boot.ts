import { detectCapabilities } from './capabilities';
import './shell.css';

export function boot(root: HTMLElement): void {
  const caps = detectCapabilities();
  root.replaceChildren(caps.webgl2 ? menuPlaceholder() : webglMessage());
}

function menuPlaceholder(): HTMLElement {
  const main = el('main', 'shell');
  main.append(el('h1', 'title', 'Breach Protocol'));
  const deploy = el('button', 'primary', 'Deploy');
  deploy.disabled = true;
  deploy.title = 'Coming in phase 1';
  main.append(deploy, el('p', 'note', 'Rebuild in progress. The original game is at /legacy/.'));
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
