import { describe, it, expect } from 'vitest';
import { FpsGovernor, ResolutionScaler } from '../../src/app/governor';
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

describe('ResolutionScaler', () => {
  it('steps down after two slow samples and keeps stepping while the fps stays low', () => {
    const s = new ResolutionScaler();
    expect(s.sample(40, 60, true)).toBeNull();
    expect(s.sample(40, 60, true)).toBeCloseTo(0.9, 9);
    // Cooldown: four samples settle the new size, then two slow ones are needed again.
    for (let i = 0; i < 5; i++) expect(s.sample(40, 60, true)).toBeNull();
    expect(s.sample(40, 60, true)).toBeCloseTo(0.8, 9);
  });

  it('never goes below the minimum scale', () => {
    const s = new ResolutionScaler();
    for (let i = 0; i < 200; i++) s.sample(10, 60, true);
    expect(s.scale).toBeCloseTo(0.6, 9);
  });

  it('steps back up after the fps holds at the target', () => {
    const s = new ResolutionScaler();
    s.sample(40, 60, true);
    s.sample(40, 60, true);
    expect(s.scale).toBeCloseTo(0.9, 9);
    let up: number | null = null;
    for (let i = 0; i < 40 && up === null; i++) up = s.sample(60, 60, true);
    expect(up).toBeCloseTo(1, 9);
  });

  it('waits longer to step up again after a rise that was followed by a drop', () => {
    const s = new ResolutionScaler();
    const run = (fps: number, n: number): number => {
      let samples = 0;
      for (let i = 0; i < n; i++) {
        samples += 1;
        if (s.sample(fps, 60, true) !== null) break;
      }
      return samples;
    };
    run(40, 2);
    const firstRise = run(60, 100);
    run(40, 100);
    const secondRise = run(60, 200);
    expect(secondRise).toBeGreaterThan(firstRise);
  });

  it('measures against the frame cap, not 60', () => {
    const s = new ResolutionScaler();
    // 30 fps is on target for a 30 fps cap.
    for (let i = 0; i < 20; i++) expect(s.sample(30, 30, true)).toBeNull();
    expect(s.scale).toBe(1);
  });

  it('does nothing while not in play, and reset returns to full scale', () => {
    const s = new ResolutionScaler();
    for (let i = 0; i < 20; i++) expect(s.sample(5, 60, false)).toBeNull();
    s.sample(30, 60, true);
    s.sample(30, 60, true);
    expect(s.scale).toBeLessThan(1);
    s.reset();
    expect(s.scale).toBe(1);
  });
});
