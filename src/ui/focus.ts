// Focus management for screens and overlays (spec §1.8, plan Phase 5). The index rules are pure functions so
// they can be unit tested without a DOM. Nothing here touches the DOM at module load.
import type { FocusScope } from './contracts';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const ROVING_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

// Index to focus after a Tab (or Shift+Tab) press in a list of `count` items. A current index of -1, or one
// outside the list, means focus is outside it: Tab goes to the first item and Shift+Tab to the last.
// Wraps at both ends.
export function nextFocusIndex(count: number, current: number, shift: boolean): number {
  if (count <= 0) return -1;
  const inList = current >= 0 && current < count;
  if (shift) return inList ? (current - 1 + count) % count : count - 1;
  return inList ? (current + 1) % count : 0;
}

// Index to focus after a roving-tabindex key press. Arrow keys step through the list and wrap. Home and End
// jump to the ends. Any other key returns `current` unchanged.
export function rovingIndex(count: number, current: number, key: string): number {
  if (count <= 0) return -1;
  const inList = current >= 0 && current < count;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return inList ? (current + 1) % count : 0;
    case 'ArrowLeft':
    case 'ArrowUp':
      return inList ? (current - 1 + count) % count : count - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return current;
  }
}

// A candidate is usable when it is not disabled, not removed from the tab order (roving groups use -1), and
// not hidden. A connected element with no boxes is hidden by CSS. Detached trees have no layout, so the
// hidden attribute is the only check there.
function isUsable(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || el.getAttribute('tabindex') === '-1') return false;
  if (el.hidden || el.closest('[hidden]') !== null) return false;
  if (el.isConnected) {
    if (el.getClientRects().length === 0) return false;
    if (el.ownerDocument.defaultView?.getComputedStyle(el).visibility === 'hidden') return false;
  }
  return true;
}

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isUsable);
}

// Traps Tab inside `root` while active. Escape calls opts.onEscape(). On deactivate, focus returns to the
// element that had it before activation, if that element is still in the document.
export function createFocusScope(root: HTMLElement, opts: { onEscape(): void }): FocusScope {
  const doc = root.ownerDocument;
  let active = false;
  let previous: HTMLElement | null = null;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      opts.onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const items = focusableIn(root);
    if (items.length === 0) return;
    const current = items.indexOf(doc.activeElement as HTMLElement);
    items[nextFocusIndex(items.length, current, event.shiftKey)]?.focus();
  };

  const scope: FocusScope = {
    activate(): void {
      if (active) return;
      active = true;
      previous = doc.activeElement as HTMLElement | null;
      doc.addEventListener('keydown', onKeyDown);
      if (!root.contains(doc.activeElement)) scope.focusFirst();
    },
    deactivate(): void {
      if (!active) return;
      active = false;
      doc.removeEventListener('keydown', onKeyDown);
      const back = previous;
      previous = null;
      if (back !== null && back.isConnected) back.focus();
    },
    focusFirst(): void {
      focusableIn(root)[0]?.focus();
    },
    get active(): boolean {
      return active;
    },
  };
  return scope;
}

// The keydown handler per container, so a second roveFocus call replaces the first and does not stack listeners.
const roveHandlers = new WeakMap<HTMLElement, (event: KeyboardEvent) => void>();

// Roving tabindex for an option grid or tab list. `options` selects the items in DOM order. Only one item has
// tabindex 0 (the first one, or the one that already has it). Arrow keys, Home and End move focus and the
// tabindex stop. The item list is read on each key press, so items added later are included.
export function roveFocus(container: HTMLElement, options: string): void {
  const itemsOf = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>(options));
  const setStop = (items: HTMLElement[], stop: number): void => {
    items.forEach((el, i) => {
      el.setAttribute('tabindex', i === stop ? '0' : '-1');
    });
  };

  const initial = itemsOf();
  if (initial.length > 0) {
    const existing = initial.findIndex((el) => el.getAttribute('tabindex') === '0');
    setStop(initial, existing < 0 ? 0 : existing);
  }

  const stale = roveHandlers.get(container);
  if (stale) container.removeEventListener('keydown', stale);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!ROVING_KEYS.has(event.key)) return;
    const items = itemsOf();
    const current = items.indexOf(event.target as HTMLElement);
    if (current < 0) return;
    event.preventDefault();
    const next = rovingIndex(items.length, current, event.key);
    setStop(items, next);
    items[next]?.focus();
  };

  container.addEventListener('keydown', onKeyDown);
  roveHandlers.set(container, onKeyDown);
}
