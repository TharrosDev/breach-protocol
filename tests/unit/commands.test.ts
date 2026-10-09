import { describe, it, expect, vi } from 'vitest';
import { buildCommand, type BindingLookup } from '../../src/input/commands';
import { KeyboardInput } from '../../src/input/keyboard';
import { MouseInput } from '../../src/input/mouse';
import type { Action } from '../../src/content/ids';

const DEFAULT_CODES: Record<Action, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  crouch: 'KeyC',
  sprint: 'ShiftLeft',
  reload: 'KeyR',
  weapon1: 'Digit1',
  weapon2: 'Digit2',
  gadget1: 'KeyQ',
  gadget2: 'KeyG',
  interact: 'KeyE',
  melee: 'KeyV',
  order: 'KeyT',
  killstreak: 'KeyF',
  scoreboard: 'Tab',
};

// Fake bindings implementing the Bindings surface that buildCommand uses.
function fakeBindings(overrides: Partial<Record<Action, string>> = {}): BindingLookup {
  const map: Record<Action, string> = { ...DEFAULT_CODES, ...overrides };
  const actions = Object.keys(map) as Action[];
  return {
    get: (action: Action) => map[action],
    actionFor: (code: string) => actions.find((a) => map[a] === code),
  };
}

const NO_MOUSE = { fire: false, ads: false };
const NO_LOOK = { dx: 0, dy: 0 };
const NONE: ReadonlySet<string> = new Set<string>();

describe('buildCommand', () => {
  it('maps W held to forward 1', () => {
    const cmd = buildCommand(new Set(['KeyW']), NO_MOUSE, NO_LOOK, NONE, fakeBindings());
    expect(cmd.move.fwd).toBe(1);
    expect(cmd.move.strafe).toBe(0);
  });

  it('cancels S and W held together to 0', () => {
    const cmd = buildCommand(new Set(['KeyW', 'KeyS']), NO_MOUSE, NO_LOOK, NONE, fakeBindings());
    expect(cmd.move.fwd).toBe(0);
  });

  it('maps D held to strafe 1', () => {
    const cmd = buildCommand(new Set(['KeyD']), NO_MOUSE, NO_LOOK, NONE, fakeBindings());
    expect(cmd.move.strafe).toBe(1);
  });

  it('moves forward on ArrowUp and not KeyW after rebinding forward', () => {
    const bindings = fakeBindings({ forward: 'ArrowUp' });
    const up = buildCommand(new Set(['ArrowUp']), NO_MOUSE, NO_LOOK, NONE, bindings);
    const w = buildCommand(new Set(['KeyW']), NO_MOUSE, NO_LOOK, NONE, bindings);
    expect(up.move.fwd).toBe(1);
    expect(w.move.fwd).toBe(0);
  });

  it('passes fire and ads through', () => {
    const cmd = buildCommand(NONE, { fire: true, ads: true }, NO_LOOK, NONE, fakeBindings());
    expect(cmd.buttons).toEqual({ fire: true, ads: true });
  });

  it('passes look deltas through', () => {
    const cmd = buildCommand(NONE, NO_MOUSE, { dx: 4, dy: -2 }, NONE, fakeBindings());
    expect(cmd.look).toEqual({ dx: 4, dy: -2 });
  });

  it('reports crouch and sprint from held keys', () => {
    const cmd = buildCommand(new Set(['KeyC', 'ShiftLeft']), NO_MOUSE, NO_LOOK, NONE, fakeBindings());
    expect(cmd.crouch).toBe(true);
    expect(cmd.sprint).toBe(true);
  });

  it('puts the action whose code is in pressedCodes into pressed', () => {
    const cmd = buildCommand(NONE, NO_MOUSE, NO_LOOK, new Set(['Space', 'KeyZ']), fakeBindings());
    expect(cmd.pressed.has('jump')).toBe(true);
    expect(cmd.pressed.size).toBe(1);
  });

  it('does not derive pressed from held keys', () => {
    const cmd = buildCommand(new Set(['Space']), NO_MOUSE, NO_LOOK, NONE, fakeBindings());
    expect(cmd.pressed.size).toBe(0);
  });
});

// Minimal stand-in for window/canvas: a real EventTarget that dispatches plain Event objects carrying the fields the handlers read.
class FakeWindow extends EventTarget {}

function keyEvent(type: 'keydown' | 'keyup', code: string, repeat = false): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code, repeat, preventDefault: vi.fn() });
}

// Same as keyEvent, but returns the preventDefault spy separately so the test can assert on it.
function keyEventWithSpy(
  type: 'keydown' | 'keyup',
  code: string,
): { event: Event; preventDefault: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn();
  const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, preventDefault });
  return { event, preventDefault };
}

describe('KeyboardInput', () => {
  it('keydown adds to held and keyup removes it', () => {
    const win = new FakeWindow();
    const kb = new KeyboardInput(() => true);
    kb.attach(win);
    win.dispatchEvent(keyEvent('keydown', 'KeyW'));
    expect(kb.held().has('KeyW')).toBe(true);
    win.dispatchEvent(keyEvent('keyup', 'KeyW'));
    expect(kb.held().has('KeyW')).toBe(false);
  });

  it('repeat keydown does not re-queue the press', () => {
    const win = new FakeWindow();
    const kb = new KeyboardInput(() => true);
    kb.attach(win);
    win.dispatchEvent(keyEvent('keydown', 'KeyR'));
    expect([...kb.drainPressed()]).toEqual(['KeyR']);
    win.dispatchEvent(keyEvent('keydown', 'KeyR', true));
    expect(kb.drainPressed().size).toBe(0);
  });

  it('drainPressed empties the queue', () => {
    const win = new FakeWindow();
    const kb = new KeyboardInput(() => true);
    kb.attach(win);
    win.dispatchEvent(keyEvent('keydown', 'KeyQ'));
    expect([...kb.drainPressed()]).toEqual(['KeyQ']);
    expect(kb.drainPressed().size).toBe(0);
  });

  it('clear empties held and the queue', () => {
    const win = new FakeWindow();
    const kb = new KeyboardInput(() => true);
    kb.attach(win);
    win.dispatchEvent(keyEvent('keydown', 'KeyA'));
    kb.clear();
    expect(kb.held().size).toBe(0);
    expect(kb.drainPressed().size).toBe(0);
  });

  it('calls preventDefault on Space and Tab only while playing', () => {
    const win = new FakeWindow();
    let playing = false;
    const kb = new KeyboardInput(() => playing);
    kb.attach(win);

    const menuSpace = keyEventWithSpy('keydown', 'Space');
    win.dispatchEvent(menuSpace.event);
    expect(menuSpace.preventDefault).not.toHaveBeenCalled();

    playing = true;
    const playTab = keyEventWithSpy('keydown', 'Tab');
    win.dispatchEvent(playTab.event);
    expect(playTab.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('stops listening after detach', () => {
    const win = new FakeWindow();
    const kb = new KeyboardInput(() => true);
    kb.attach(win);
    kb.detach();
    win.dispatchEvent(keyEvent('keydown', 'KeyW'));
    expect(kb.held().size).toBe(0);
  });
});

function mouseEvent(type: string, fields: Record<string, number> = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), fields);
}

// The canvas and window only need addEventListener/removeEventListener, so FakeWindow stands in for both.
function attachMouse(isPlaying: () => boolean): { mouse: MouseInput; canvas: FakeWindow; win: FakeWindow } {
  const canvas = new FakeWindow();
  const win = new FakeWindow();
  const mouse = new MouseInput(isPlaying);
  mouse.attach(canvas as unknown as HTMLElement, win);
  return { mouse, canvas, win };
}

describe('MouseInput', () => {
  it('accumulates mousemove deltas and drainLook resets them', () => {
    const { mouse, win } = attachMouse(() => true);
    win.dispatchEvent(mouseEvent('mousemove', { movementX: 3, movementY: -1 }));
    win.dispatchEvent(mouseEvent('mousemove', { movementX: 2, movementY: 5 }));
    expect(mouse.drainLook()).toEqual({ dx: 5, dy: 4 });
    expect(mouse.drainLook()).toEqual({ dx: 0, dy: 0 });
  });

  it('ignores mousemove while not playing', () => {
    const { mouse, win } = attachMouse(() => false);
    win.dispatchEvent(mouseEvent('mousemove', { movementX: 9, movementY: 9 }));
    expect(mouse.drainLook()).toEqual({ dx: 0, dy: 0 });
  });

  it('button 0 sets fire and button 2 sets ads, and mouseup clears them', () => {
    const { mouse, canvas, win } = attachMouse(() => true);
    canvas.dispatchEvent(mouseEvent('mousedown', { button: 0 }));
    expect(mouse.buttons()).toEqual({ fire: true, ads: false });
    canvas.dispatchEvent(mouseEvent('mousedown', { button: 2 }));
    expect(mouse.buttons()).toEqual({ fire: true, ads: true });
    win.dispatchEvent(mouseEvent('mouseup', { button: 0 }));
    win.dispatchEvent(mouseEvent('mouseup', { button: 2 }));
    expect(mouse.buttons()).toEqual({ fire: false, ads: false });
  });

  it('ignores mousedown while not playing', () => {
    const { mouse, canvas } = attachMouse(() => false);
    canvas.dispatchEvent(mouseEvent('mousedown', { button: 0 }));
    expect(mouse.buttons().fire).toBe(false);
  });

  it('prevents the contextmenu default', () => {
    const { win } = attachMouse(() => true);
    const menu = mouseEvent('contextmenu');
    win.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('clear resets the flags', () => {
    const { mouse, canvas } = attachMouse(() => true);
    canvas.dispatchEvent(mouseEvent('mousedown', { button: 0 }));
    canvas.dispatchEvent(mouseEvent('mousedown', { button: 2 }));
    mouse.clear();
    expect(mouse.buttons()).toEqual({ fire: false, ads: false });
  });
});
