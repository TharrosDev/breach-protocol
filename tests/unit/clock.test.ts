import { describe, it, expect } from 'vitest';
import { FixedStep } from '../../src/core/clock';

describe('FixedStep', () => {
  it('exposes dt as 1/hz', () => {
    expect(new FixedStep(60).dt).toBeCloseTo(1 / 60, 12);
    expect(new FixedStep(30).dt).toBeCloseTo(1 / 30, 12);
  });

  it('returns one step for a 1/60 s frame', () => {
    const clock = new FixedStep(60);
    expect(clock.advance(1 / 60)).toBe(1);
  });

  it('returns 0 then 1 for two 1/120 s frames', () => {
    const clock = new FixedStep(60);
    expect(clock.advance(1 / 120)).toBe(0);
    expect(clock.advance(1 / 120)).toBe(1);
  });

  it('clamps a 1 s frame to 0.25 s and returns 15 steps', () => {
    const clock = new FixedStep(60, 0.25);
    expect(clock.advance(1)).toBe(15);
  });

  it('never runs more than maxSteps in a frame and drops the backlog instead of carrying it', () => {
    const clock = new FixedStep(60, 0.25, 5);
    expect(clock.advance(0.25)).toBe(5);
    // The 10 steps that did not run are gone: the next normal frame is a normal frame.
    expect(clock.advance(1 / 60)).toBe(1);
    expect(clock.dropped).toBeCloseTo(10 / 60, 9);
    expect(clock.alpha).toBeGreaterThanOrEqual(0);
    expect(clock.alpha).toBeLessThan(1);
  });

  it('keeps alpha in [0, 1) across a varied frame sequence', () => {
    const clock = new FixedStep(60);
    const frames = [0.001, 0.0167, 0.05, 1, 0, 0.0333, 0.25, 1 / 120, 0.4, 0.0041];
    for (let i = 0; i < 200; i++) {
      const frame = frames[i % frames.length] ?? 0;
      clock.advance(frame);
      expect(clock.alpha).toBeGreaterThanOrEqual(0);
      expect(clock.alpha).toBeLessThan(1);
    }
  });

  it('carries the leftover time into alpha', () => {
    const clock = new FixedStep(60);
    clock.advance(1 / 120);
    expect(clock.alpha).toBeCloseTo(0.5, 9);
  });

  it('treats negative and NaN frame times as zero', () => {
    const clock = new FixedStep(60);
    expect(clock.advance(-1)).toBe(0);
    expect(clock.advance(Number.NaN)).toBe(0);
    expect(clock.alpha).toBe(0);
  });
});
