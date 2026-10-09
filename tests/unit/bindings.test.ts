import { describe, expect, it } from 'vitest';
import { ACTION_LABELS, DEFAULT_BINDINGS } from '../../src/content/bindingDefaults';
import { ACTIONS } from '../../src/content/ids';
import { Bindings } from '../../src/input/bindings';

describe('default bindings', () => {
  it('has a code and a label for each of the 17 actions, with unique default codes', () => {
    expect(ACTIONS).toHaveLength(17);
    for (const action of ACTIONS) {
      expect(DEFAULT_BINDINGS[action]).toBeTruthy();
      expect(ACTION_LABELS[action]).toBeTruthy();
    }
    expect(new Set(Object.values(DEFAULT_BINDINGS)).size).toBe(ACTIONS.length);
  });

  it('matches the legacy default codes', () => {
    expect(DEFAULT_BINDINGS.forward).toBe('KeyW');
    expect(DEFAULT_BINDINGS.jump).toBe('Space');
    expect(DEFAULT_BINDINGS.crouch).toBe('ControlLeft');
    expect(DEFAULT_BINDINGS.scoreboard).toBe('Tab');
    expect(ACTION_LABELS.interact).toBe('Interact (resupply / breach)');
  });
});

describe('Bindings', () => {
  it('starts from the defaults when given nothing usable', () => {
    for (const source of [undefined, null, 'x', 7, [], {}]) {
      const b = new Bindings(source);
      expect(b.toJSON()).toEqual(DEFAULT_BINDINGS);
      expect(b.conflicts()).toEqual([]);
    }
  });

  it('get and actionFor are inverses for the default codes', () => {
    const b = new Bindings(DEFAULT_BINDINGS);
    expect(b.get('reload')).toBe('KeyR');
    expect(b.actionFor('KeyR')).toBe('reload');
    expect(b.actionFor('KeyZ')).toBeUndefined();
  });

  it('copies the source record', () => {
    const source: Record<string, string> = { ...DEFAULT_BINDINGS };
    const b = new Bindings(source);
    source.forward = 'KeyP';
    expect(b.get('forward')).toBe('KeyW');
  });

  it('keeps valid loaded values and falls back per action for invalid ones', () => {
    const b = new Bindings({ forward: 42, back: '', left: 'KeyJ', right: null });
    expect(b.get('forward')).toBe(DEFAULT_BINDINGS.forward);
    expect(b.get('back')).toBe(DEFAULT_BINDINGS.back);
    expect(b.get('left')).toBe('KeyJ');
    expect(b.get('right')).toBe(DEFAULT_BINDINGS.right);
  });

  it('drops unknown action keys from the output', () => {
    const b = new Bindings({ ...DEFAULT_BINDINGS, flyUp: 'KeyX' });
    expect(Object.keys(b.toJSON())).toHaveLength(17);
    expect(b.actionFor('KeyX')).toBeUndefined();
  });

  it('set() on a free code only changes that action', () => {
    const b = new Bindings(DEFAULT_BINDINGS);
    b.set('reload', 'KeyT');
    expect(b.get('reload')).toBe('KeyT');
    expect(b.get('forward')).toBe('KeyW');
    expect(b.actionFor('KeyR')).toBeUndefined();
  });

  it('set() of a code already in use swaps the two actions', () => {
    const b = new Bindings(DEFAULT_BINDINGS);
    b.set('jump', 'KeyW');
    expect(b.get('jump')).toBe('KeyW');
    expect(b.get('forward')).toBe('Space');
    expect(b.actionFor('Space')).toBe('forward');
    expect(b.conflicts()).toEqual([]);
  });

  it('set() of an action to its own code changes nothing', () => {
    const b = new Bindings(DEFAULT_BINDINGS);
    b.set('forward', 'KeyW');
    expect(b.toJSON()).toEqual(DEFAULT_BINDINGS);
  });

  it('reset() restores the defaults', () => {
    const b = new Bindings(DEFAULT_BINDINGS);
    b.set('jump', 'KeyW');
    b.reset();
    expect(b.toJSON()).toEqual(DEFAULT_BINDINGS);
  });

  it('toJSON returns a copy', () => {
    const b = new Bindings(DEFAULT_BINDINGS);
    const out = b.toJSON();
    out.forward = 'KeyP';
    expect(b.get('forward')).toBe('KeyW');
  });

  it('gives a later duplicate its default when that default is free', () => {
    // jump holds KeyW, which forward (earlier in ACTIONS) already keeps. Jump's default Space is free.
    const b = new Bindings({ jump: 'KeyW' });
    expect(b.get('forward')).toBe('KeyW');
    expect(b.get('jump')).toBe('Space');
    expect(b.conflicts()).toEqual([]);
  });

  it('reports a later duplicate it cannot resolve through conflicts()', () => {
    // reload loads KeyR, which jump keeps (jump is earlier). Reload's default KeyR is taken, so it stays.
    const b = new Bindings({ jump: 'KeyR' });
    expect(b.get('jump')).toBe('KeyR');
    expect(b.get('reload')).toBe('KeyR');
    expect(b.actionFor('KeyR')).toBe('jump');
    expect(b.conflicts()).toEqual(['reload']);
  });

  it('conflicts() reflects later changes made with set()', () => {
    const b = new Bindings({ jump: 'KeyR' });
    b.set('reload', 'KeyT');
    expect(b.conflicts()).toEqual([]);
    expect(b.get('reload')).toBe('KeyT');
  });
});
