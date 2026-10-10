import { describe, it, expect } from 'vitest';
import { Bindings } from '../../src/input/bindings';
import {
  GamepadInput,
  LOOK_PIXELS_PER_SECOND,
  PAD_BUTTON,
  STICK_DEADZONE,
  applyDeadzone,
  heldCodes,
  lookCurve,
  readPad,
  type PadSnapshot,
} from '../../src/input/gamepad';
import { PadNavigator, navHeld } from '../../src/input/pad-nav';
import { buildCommand } from '../../src/input/commands';

const bindings = new Bindings({});

interface PadSpec {
  axes?: [number, number, number, number];
  down?: (keyof typeof PAD_BUTTON)[];
  lt?: number;
  rt?: number;
}

function pad(spec: PadSpec = {}): PadSnapshot {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const name of spec.down ?? []) buttons[PAD_BUTTON[name]] = { pressed: true, value: 1 };
  if (spec.lt !== undefined) buttons[PAD_BUTTON.lt] = { pressed: spec.lt > 0.5, value: spec.lt };
  if (spec.rt !== undefined) buttons[PAD_BUTTON.rt] = { pressed: spec.rt > 0.5, value: spec.rt };
  return { axes: spec.axes ?? [0, 0, 0, 0], buttons };
}

describe('stick processing', () => {
  it('ignores a stick inside the dead zone and rescales outside it', () => {
    expect(applyDeadzone(STICK_DEADZONE * 0.9, 0)).toEqual({ x: 0, y: 0 });
    expect(applyDeadzone(1, 0).x).toBeCloseTo(1, 9);
    const half = applyDeadzone(0.6, 0);
    expect(half.x).toBeGreaterThan(0);
    expect(half.x).toBeLessThan(0.6);
    expect(applyDeadzone(Number.NaN, 0)).toEqual({ x: 0, y: 0 });
  });

  it('the look curve is gentle near the centre, full at the edge, and keeps the sign', () => {
    expect(lookCurve(0.5)).toBeLessThan(0.5);
    expect(lookCurve(1)).toBe(1);
    expect(lookCurve(-0.5)).toBeCloseTo(-lookCurve(0.5), 9);
  });
});

describe('readPad and held codes', () => {
  it('a missing pad reads as idle', () => {
    const f = readPad(null);
    expect(f.fire).toBe(false);
    expect(f.buttons.size).toBe(0);
  });

  it('the left stick becomes the four movement keys through the bindings', () => {
    const held = heldCodes(readPad(pad({ axes: [0, -1, 0, 0] })), bindings);
    expect([...held]).toEqual([bindings.get('forward')]);
    const diag = heldCodes(readPad(pad({ axes: [1, 1, 0, 0] })), bindings);
    expect(diag.has(bindings.get('back'))).toBe(true);
    expect(diag.has(bindings.get('right'))).toBe(true);
  });

  it('follows a rebinding', () => {
    const b = new Bindings({ forward: 'ArrowUp' });
    expect(heldCodes(readPad(pad({ axes: [0, -1, 0, 0] })), b).has('ArrowUp')).toBe(true);
  });

  it('B crouches, L3 sprints and the d-pad down holds the scoreboard', () => {
    const held = heldCodes(readPad(pad({ down: ['b', 'l3', 'down'] })), bindings);
    expect(held.has(bindings.get('crouch'))).toBe(true);
    expect(held.has(bindings.get('sprint'))).toBe(true);
    expect(held.has(bindings.get('scoreboard'))).toBe(true);
  });

  it('the triggers are fire and aim, by analogue value too', () => {
    const f = readPad(pad({ rt: 0.9, lt: 0.45 }));
    expect(f.fire).toBe(true);
    expect(f.ads).toBe(true);
    const light = readPad(pad({ rt: 0.1, lt: 0.1 }));
    expect(light.fire).toBe(false);
    expect(light.ads).toBe(false);
  });

  it('a pad command drives the sim command builder like keys do', () => {
    const f = readPad(pad({ axes: [-1, -1, 0, 0], down: ['l3'], rt: 1 }));
    const cmd = buildCommand(
      heldCodes(f, bindings),
      { fire: f.fire, ads: f.ads },
      { dx: 0, dy: 0 },
      new Set(),
      bindings,
    );
    expect(cmd.move).toEqual({ fwd: 1, strafe: -1 });
    expect(cmd.sprint).toBe(true);
    expect(cmd.buttons.fire).toBe(true);
  });
});

describe('GamepadInput', () => {
  function input(frames: PadSnapshot[]): { pad: GamepadInput; next: () => void } {
    let i = 0;
    const g = new GamepadInput(() => [frames[Math.min(i, frames.length - 1)] ?? null]);
    return {
      pad: g,
      next() {
        i += 1;
        g.poll();
      },
    };
  }

  it('is not connected without a pad', () => {
    const g = new GamepadInput(() => [null]);
    g.poll();
    expect(g.connected).toBe(false);
  });

  it('queues a press once, even for a tap between two frames', () => {
    const { pad: g, next } = input([pad(), pad({ down: ['a'] }), pad()]);
    g.poll();
    next();
    next();
    expect([...g.drainPressed(bindings)]).toEqual([bindings.get('jump')]);
    expect(g.drainPressed(bindings).size).toBe(0);
  });

  it('a held button is one press, not one per frame', () => {
    const held = pad({ down: ['x'] });
    const { pad: g, next } = input([held, held, held]);
    g.poll();
    next();
    next();
    expect([...g.drainPressed(bindings)]).toEqual([bindings.get('reload')]);
  });

  it('maps the gadgets, melee, killstreak, order and interact buttons', () => {
    const cases: [keyof typeof PAD_BUTTON, string][] = [
      ['lb', bindings.get('gadget1')],
      ['rb', bindings.get('gadget2')],
      ['r3', bindings.get('melee')],
      ['up', bindings.get('killstreak')],
      ['left', bindings.get('order')],
      ['right', bindings.get('interact')],
    ];
    for (const [button, code] of cases) {
      const { pad: g, next } = input([pad(), pad({ down: [button] })]);
      g.poll();
      next();
      expect([...g.drainPressed(bindings)]).toEqual([code]);
    }
  });

  it('Y swaps between the two weapon slots', () => {
    const { pad: g, next } = input([pad(), pad({ down: ['y'] }), pad(), pad({ down: ['y'] })]);
    g.poll();
    next();
    expect([...g.drainPressed(bindings)]).toEqual([bindings.get('weapon2')]);
    next();
    next();
    expect([...g.drainPressed(bindings)]).toEqual([bindings.get('weapon1')]);
  });

  it('a trigger pull is a fire edge once', () => {
    const { pad: g, next } = input([pad(), pad({ rt: 1 }), pad({ rt: 1 })]);
    g.poll();
    next();
    expect(g.takeFireEdge()).toBe(true);
    next();
    expect(g.takeFireEdge()).toBe(false);
    expect(g.buttons().fire).toBe(true);
  });

  it('Start is reported once and does not leak into the key presses', () => {
    const { pad: g, next } = input([pad(), pad({ down: ['start'] })]);
    g.poll();
    next();
    expect(g.takeStart()).toBe(true);
    expect(g.takeStart()).toBe(false);
    expect(g.drainPressed(bindings).size).toBe(0);
  });

  it('look is scaled by time and the response curve', () => {
    const { pad: g } = input([pad({ axes: [0, 0, 1, 0] })]);
    g.poll();
    expect(g.look(0.5).dx).toBeCloseTo(LOOK_PIXELS_PER_SECOND * 0.5, 6);
    expect(g.look(0).dx).toBe(0);
    expect(g.look(1).dy).toBe(0);
  });

  it('a throwing Gamepad API leaves the pad disconnected', () => {
    const g = new GamepadInput(() => {
      throw new Error('denied');
    });
    expect(() => {
      g.poll();
    }).not.toThrow();
    expect(g.connected).toBe(false);
  });
});

describe('menu navigation', () => {
  it('reads the d-pad, the left stick, A and B', () => {
    expect([...navHeld(pad({ down: ['down', 'a'] }))].sort()).toEqual(['confirm', 'down']);
    expect(navHeld(pad({ axes: [-1, 0, 0, 0] })).has('left')).toBe(true);
    expect(navHeld(pad({ down: ['b'] })).has('back')).toBe(true);
    expect(navHeld(null).size).toBe(0);
  });

  it('fires once on press, repeats a held direction after a delay, never repeats A', () => {
    const nav = new PadNavigator();
    const down = pad({ down: ['down', 'a'] });
    expect(nav.step(down, 0.016).sort()).toEqual(['confirm', 'down']);
    expect(nav.step(down, 0.2)).toEqual([]);
    expect(nav.step(down, 0.3)).toEqual(['down']);
    expect(nav.step(down, 0.05)).toEqual([]);
    expect(nav.step(down, 0.1)).toEqual(['down']);
    // Release, then press again: fires again.
    expect(nav.step(pad(), 0.016)).toEqual([]);
    expect(nav.step(pad({ down: ['down'] }), 0.016)).toEqual(['down']);
  });
});
