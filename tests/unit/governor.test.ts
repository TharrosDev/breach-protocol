import { describe, it, expect } from 'vitest';
import { FpsGovernor } from '../../src/app/governor';
import type { Quality } from '../../src/persist/schema';

// Feeds n samples at the given fps and returns the results in order.
function feed(g: FpsGovernor, n: number, fps: number, inPlay = true, quality: Quality = 'high'): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(g.sample(fps, inPlay, quality));
  return out;
}

describe('FpsGovernor', () => {
  it('downgrades exactly once on the 10th slow sample (5 s at 0.5 s steps)', () => {
    const g = new FpsGovernor();
    const results = feed(g, 10, 30);
    expect(results.slice(0, 9).every((r) => r === 'none')).toBe(true);
    expect(results[9]).toBe('downgrade');
  });

  it('restarts the count after a downgrade', () => {
    const g = new FpsGovernor();
    feed(g, 10, 30);
    expect(feed(g, 9, 30)).toEqual(Array<string>(9).fill('none'));
    expect(g.sample(30, true, 'high')).toBe('downgrade');
  });

  it('a fast sample resets the timer', () => {
    const g = new FpsGovernor();
    feed(g, 9, 30);
    expect(g.sample(60, true, 'high')).toBe('none');
    expect(feed(g, 9, 30)).toEqual(Array<string>(9).fill('none'));
    expect(g.sample(30, true, 'high')).toBe('downgrade');
  });

  it('a sample at exactly the threshold counts as fast', () => {
    const g = new FpsGovernor();
    feed(g, 9, 30);
    expect(g.sample(38, true, 'high')).toBe('none');
    expect(feed(g, 9, 30)).toEqual(Array<string>(9).fill('none'));
  });

  it('never downgrades when quality is already low', () => {
    const g = new FpsGovernor();
    expect(feed(g, 30, 10, true, 'low')).toEqual(Array<string>(30).fill('none'));
  });

  it('never downgrades when not in play', () => {
    const g = new FpsGovernor();
    expect(feed(g, 30, 10, false, 'high')).toEqual(Array<string>(30).fill('none'));
  });

  it('leaves the timer alone while not playing, as legacy does', () => {
    const g = new FpsGovernor();
    feed(g, 9, 30);
    feed(g, 5, 30, false);
    expect(g.sample(30, true, 'high')).toBe('downgrade');
  });

  it('reset() clears the timer', () => {
    const g = new FpsGovernor();
    feed(g, 9, 30);
    g.reset();
    expect(feed(g, 9, 30)).toEqual(Array<string>(9).fill('none'));
    expect(g.sample(30, true, 'high')).toBe('downgrade');
  });

  it('accepts a custom window', () => {
    const g = new FpsGovernor({ windowSeconds: 1 });
    expect(feed(g, 2, 30)).toEqual(['none', 'downgrade']);
  });
});
