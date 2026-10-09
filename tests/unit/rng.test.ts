import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/core/rng';

function take(rng: { next(): number }, count: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < count; i++) values.push(rng.next());
  return values;
}

describe('createRng', () => {
  it('gives the same first 1000 values for the same seed', () => {
    expect(take(createRng(12345), 1000)).toEqual(take(createRng(12345), 1000));
  });

  it('diverges for different seeds', () => {
    const a = take(createRng(1), 1000);
    const b = take(createRng(2), 1000);
    expect(a).not.toEqual(b);
    expect(a[0]).not.toBe(b[0]);
  });

  it('draws 100 000 values in [0, 1) with mean within 0.01 of 0.5', () => {
    const values = take(createRng(99), 100_000);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.01);
    expect(values.filter((v) => v < 0 || v >= 1)).toEqual([]);
  });

  it('range() stays in [a, b)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.range(-3, 5);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(5);
    }
  });

  it('pick() returns only items from the array and throws on empty input', () => {
    const rng = createRng(3);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 1000; i++) {
      expect(items).toContain(rng.pick(items));
    }
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('fork("a") and fork("b") from one parent differ, and each is reproducible', () => {
    const parent = createRng(42);
    const forkA = take(parent.fork('a'), 100);
    const forkB = take(parent.fork('b'), 100);
    expect(forkA).not.toEqual(forkB);
    expect(take(createRng(42).fork('a'), 100)).toEqual(forkA);
    expect(take(createRng(42).fork('b'), 100)).toEqual(forkB);
  });

  it('fork() does not advance the parent stream', () => {
    const withFork = createRng(5);
    withFork.fork('child');
    expect(take(withFork, 50)).toEqual(take(createRng(5), 50));
  });
});
