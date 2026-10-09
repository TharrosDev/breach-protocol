import { describe, it, expect } from 'vitest';
import { nextFocusIndex, rovingIndex } from '../../src/ui/focus';

describe('nextFocusIndex', () => {
  it('steps forward through the list and wraps from the last item to the first', () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 1, false)).toBe(2);
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });

  it('steps backward through the list and wraps from the first item to the last', () => {
    expect(nextFocusIndex(3, 2, true)).toBe(1);
    expect(nextFocusIndex(3, 1, true)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });

  it('starts at the first item for Tab and at the last for Shift+Tab when focus is outside the list', () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
    expect(nextFocusIndex(3, 7, false)).toBe(0);
    expect(nextFocusIndex(3, 7, true)).toBe(2);
  });

  it('keeps focus on the only item for either direction', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
    expect(nextFocusIndex(1, -1, false)).toBe(0);
  });

  it('returns -1 for an empty list', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
    expect(nextFocusIndex(0, 0, true)).toBe(-1);
  });

  it('visits every item exactly once in a full forward cycle, and in a full backward cycle', () => {
    for (let count = 1; count <= 8; count++) {
      const forward = new Set<number>();
      let idx = 0;
      for (let step = 0; step < count; step++) {
        forward.add(idx);
        idx = nextFocusIndex(count, idx, false);
      }
      expect(forward.size).toBe(count);
      expect(idx).toBe(0);

      const backward = new Set<number>();
      idx = count - 1;
      for (let step = 0; step < count; step++) {
        backward.add(idx);
        idx = nextFocusIndex(count, idx, true);
      }
      expect(backward.size).toBe(count);
      expect(idx).toBe(count - 1);
    }
  });

  it('is the inverse of itself: forward then backward returns to the same item', () => {
    for (let count = 1; count <= 6; count++) {
      for (let i = 0; i < count; i++) {
        expect(nextFocusIndex(count, nextFocusIndex(count, i, false), true)).toBe(i);
      }
    }
  });
});

describe('rovingIndex', () => {
  it('ArrowRight and ArrowDown move forward and wrap', () => {
    expect(rovingIndex(3, 0, 'ArrowRight')).toBe(1);
    expect(rovingIndex(3, 0, 'ArrowDown')).toBe(1);
    expect(rovingIndex(3, 2, 'ArrowRight')).toBe(0);
    expect(rovingIndex(3, 2, 'ArrowDown')).toBe(0);
  });

  it('ArrowLeft and ArrowUp move backward and wrap', () => {
    expect(rovingIndex(3, 2, 'ArrowLeft')).toBe(1);
    expect(rovingIndex(3, 2, 'ArrowUp')).toBe(1);
    expect(rovingIndex(3, 0, 'ArrowLeft')).toBe(2);
    expect(rovingIndex(3, 0, 'ArrowUp')).toBe(2);
  });

  it('Home goes to the first item and End to the last, from any position', () => {
    for (let i = 0; i < 4; i++) {
      expect(rovingIndex(4, i, 'Home')).toBe(0);
      expect(rovingIndex(4, i, 'End')).toBe(3);
    }
  });

  it('returns the current index for keys it does not handle', () => {
    for (const key of ['a', 'Enter', ' ', 'Tab', 'Escape', 'PageDown']) {
      expect(rovingIndex(3, 1, key)).toBe(1);
    }
  });

  it('starts at the first item for forward keys and the last for backward keys when the current index is outside the list', () => {
    expect(rovingIndex(3, -1, 'ArrowRight')).toBe(0);
    expect(rovingIndex(3, -1, 'ArrowDown')).toBe(0);
    expect(rovingIndex(3, -1, 'ArrowLeft')).toBe(2);
    expect(rovingIndex(3, -1, 'ArrowUp')).toBe(2);
  });

  it('keeps a single item selected on every arrow key', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(rovingIndex(1, 0, key)).toBe(0);
    }
  });

  it('returns -1 for an empty list', () => {
    expect(rovingIndex(0, -1, 'ArrowRight')).toBe(-1);
    expect(rovingIndex(0, 0, 'Home')).toBe(-1);
  });
});
