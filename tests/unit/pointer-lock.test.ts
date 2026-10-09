import { describe, it, expect } from 'vitest';
import { PointerLock } from '../../src/input/pointer-lock';

// A document-like object with a settable pointerLockElement that dispatches pointerlockchange.
class FakeDocument extends EventTarget {
  pointerLockElement: unknown = null;
}

function setup(requestPointerLock: () => unknown) {
  const doc = new FakeDocument();
  const target = { requestPointerLock };
  const lock = new PointerLock(target, doc);
  return { doc, target, lock };
}

describe('PointerLock.request', () => {
  it('resolves false when requestPointerLock throws synchronously', async () => {
    const { lock } = setup(() => {
      throw new Error('refused');
    });
    await expect(lock.request()).resolves.toBe(false);
  });

  it('resolves false when requestPointerLock rejects', async () => {
    const { lock } = setup(() => Promise.reject(new Error('refused')));
    await expect(lock.request()).resolves.toBe(false);
  });

  it('resolves true when the target becomes pointerLockElement', async () => {
    const { doc, target, lock } = setup(() => {
      doc.pointerLockElement = target;
    });
    await expect(lock.request()).resolves.toBe(true);
  });

  it('resolves true when the target becomes pointerLockElement asynchronously', async () => {
    const { doc, target, lock } = setup(async () => {
      await Promise.resolve();
      doc.pointerLockElement = target;
    });
    await expect(lock.request()).resolves.toBe(true);
  });

  it('resolves false when the request resolves but another element holds the lock', async () => {
    const { doc, lock } = setup(() => {
      doc.pointerLockElement = {};
    });
    await expect(lock.request()).resolves.toBe(false);
  });
});

describe('PointerLock.onChange', () => {
  it('reports lock state changes from pointerlockchange', () => {
    const { doc, target, lock } = setup(() => undefined);
    const seen: boolean[] = [];
    lock.onChange((locked) => seen.push(locked));
    lock.attach();

    doc.pointerLockElement = target;
    doc.dispatchEvent(new Event('pointerlockchange'));
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));

    expect(seen).toEqual([true, false]);
  });

  it('stops calling a callback after its unsubscribe runs', () => {
    const { doc, target, lock } = setup(() => undefined);
    const seen: boolean[] = [];
    const unsubscribe = lock.onChange((locked) => seen.push(locked));
    lock.attach();

    doc.pointerLockElement = target;
    doc.dispatchEvent(new Event('pointerlockchange'));
    unsubscribe();
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));

    expect(seen).toEqual([true]);
  });

  it('stops reporting after detach', () => {
    const { doc, target, lock } = setup(() => undefined);
    const seen: boolean[] = [];
    lock.onChange((locked) => seen.push(locked));
    lock.attach();
    lock.detach();

    doc.pointerLockElement = target;
    doc.dispatchEvent(new Event('pointerlockchange'));

    expect(seen).toEqual([]);
  });
});
