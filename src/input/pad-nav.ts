// Menu navigation with a gamepad. The d-pad and the left stick move through the controls, A activates, B goes back.
// It drives the screens the way a keyboard does: arrow keys are sent to the focused control first (option grids and
// tab lists have their own arrow handling), and when nothing handled them focus moves to the next or previous
// control on the visible screen. Escape for B goes through the same listeners the screens already have.
import { PAD_BUTTON, type PadSnapshot } from './gamepad';

export type NavAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

const STICK_NAV = 0.6;
// Seconds a direction is held before it repeats, and the repeat interval after that.
const REPEAT_DELAY = 0.4;
const REPEAT_EVERY = 0.12;

function pressed(pad: PadSnapshot, index: number): boolean {
  return pad.buttons[index]?.pressed === true;
}

// What is held right now, as a set of navigation actions.
export function navHeld(pad: PadSnapshot | null): Set<NavAction> {
  const out = new Set<NavAction>();
  if (pad === null) return out;
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  if (pressed(pad, PAD_BUTTON.up) || y < -STICK_NAV) out.add('up');
  if (pressed(pad, PAD_BUTTON.down) || y > STICK_NAV) out.add('down');
  if (pressed(pad, PAD_BUTTON.left) || x < -STICK_NAV) out.add('left');
  if (pressed(pad, PAD_BUTTON.right) || x > STICK_NAV) out.add('right');
  if (pressed(pad, PAD_BUTTON.a)) out.add('confirm');
  if (pressed(pad, PAD_BUTTON.b)) out.add('back');
  return out;
}

const REPEATING: ReadonlySet<NavAction> = new Set(['up', 'down', 'left', 'right']);

// Turns held state into one-shot actions: a new press fires at once, and a held direction repeats.
export class PadNavigator {
  private held = new Map<NavAction, number>();

  // dt in seconds since the last step. Returns the actions that fire this step.
  step(pad: PadSnapshot | null, dt: number): NavAction[] {
    const now = navHeld(pad);
    const fired: NavAction[] = [];
    const next = new Map<NavAction, number>();
    for (const action of now) {
      const before = this.held.get(action);
      if (before === undefined) {
        fired.push(action);
        next.set(action, 0);
        continue;
      }
      const age = before + dt;
      if (REPEATING.has(action) && age >= REPEAT_DELAY) {
        fired.push(action);
        next.set(action, REPEAT_DELAY - REPEAT_EVERY);
      } else {
        next.set(action, age);
      }
    }
    this.held = next;
    return fired;
  }

  reset(): void {
    // Called every frame while a match is in play, so it allocates only when something was held.
    if (this.held.size > 0) this.held = new Map();
  }
}

const FOCUSABLE = 'button, input, select, [tabindex]:not([tabindex="-1"])';

function visibleControls(doc: Document): HTMLElement[] {
  const roots = Array.from(doc.querySelectorAll<HTMLElement>('.scr:not([hidden])'));
  const root = roots[roots.length - 1];
  if (root === undefined) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.closest('[hidden]') === null &&
      el.getClientRects().length > 0 &&
      // Roving groups keep one tab stop. The rest are reached with the arrows inside the group.
      (el.getAttribute('tabindex') !== '-1' || el.getAttribute('role') === 'radio'),
  );
}

function key(name: string): KeyboardEventInit {
  return { key: name, code: name, bubbles: true, cancelable: true };
}

// Applies one action to the page. Returns true when something handled it.
export function applyNav(doc: Document, action: NavAction): boolean {
  const active = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  if (action === 'back') {
    (active ?? doc.body).dispatchEvent(new KeyboardEvent('keydown', key('Escape')));
    return true;
  }
  if (action === 'confirm') {
    if (active === null || active === doc.body) return false;
    active.click();
    return true;
  }
  const arrow = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[action];
  if (
    active instanceof HTMLInputElement &&
    active.type === 'range' &&
    (action === 'left' || action === 'right')
  ) {
    if (action === 'left') active.stepDown();
    else active.stepUp();
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (active instanceof HTMLSelectElement && (action === 'up' || action === 'down')) {
    const to = Math.min(
      active.options.length - 1,
      Math.max(0, active.selectedIndex + (action === 'down' ? 1 : -1)),
    );
    if (to !== active.selectedIndex) {
      active.selectedIndex = to;
      active.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }
  if (active !== null) {
    const event = new KeyboardEvent('keydown', key(arrow));
    active.dispatchEvent(event);
    if (event.defaultPrevented) return true;
  }
  const controls = visibleControls(doc);
  if (controls.length === 0) return false;
  const at = active === null ? -1 : controls.indexOf(active);
  const forward = action === 'down' || action === 'right';
  const target =
    at < 0
      ? forward
        ? 0
        : controls.length - 1
      : (at + (forward ? 1 : -1) + controls.length) % controls.length;
  controls[target]?.focus();
  return true;
}

export interface PadNavHandle {
  dispose(): void;
}

// Polls the first connected pad each animation frame while `active()` is true and drives the visible screen.
export function startPadNav(
  win: Window,
  active: () => boolean,
  getPad: () => PadSnapshot | null = () => firstPad(win),
): PadNavHandle {
  const nav = new PadNavigator();
  let raf = 0;
  let last: number | null = null;
  let stopped = false;
  const tick = (now: number): void => {
    if (stopped) return;
    raf = win.requestAnimationFrame(tick);
    const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!active()) {
      nav.reset();
      return;
    }
    for (const action of nav.step(getPad(), dt)) applyNav(win.document, action);
  };
  raf = win.requestAnimationFrame(tick);
  return {
    dispose() {
      stopped = true;
      win.cancelAnimationFrame(raf);
    },
  };
}

function firstPad(win: Window): PadSnapshot | null {
  try {
    const pads =
      typeof win.navigator.getGamepads === 'function' ? Array.from(win.navigator.getGamepads()) : [];
    return pads.find((p): p is Gamepad => p !== null) ?? null;
  } catch {
    return null;
  }
}
