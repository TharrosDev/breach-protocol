import { detectCapabilities } from './capabilities';
import { mountShell } from './shell';

// Checks WebGL 2 (the renderer needs it), then mounts the shell. Without WebGL 2 the page shows a message with a
// retry link and no screens.
export function boot(root: HTMLElement): void {
  const caps = detectCapabilities();
  if (caps.webgl2) {
    mountShell(root);
  } else {
    root.replaceChildren(webglMessage());
  }
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
  retry.type = 'button';
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
