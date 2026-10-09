import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/core/rng';
import { grassPlacements } from '../../src/render/grass';

const ZONES = [
  { x: -29, z: -28 },
  { x: 29, z: -28 },
  { x: 1, z: 22 },
];

const always = (): boolean => true;

describe('grassPlacements', () => {
  it('keeps every tuft inside the -55..55 square', () => {
    const out = grassPlacements(createRng(7), 900, always, []);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(-55);
      expect(p.x).toBeLessThan(55);
      expect(p.z).toBeGreaterThanOrEqual(-55);
      expect(p.z).toBeLessThan(55);
    }
  });

  it('returns exactly count tufts when every point is open', () => {
    expect(grassPlacements(createRng(7), 260, always, [])).toHaveLength(260);
    expect(grassPlacements(createRng(7), 900, always, [])).toHaveLength(900);
  });

  it('never returns more than count', () => {
    expect(grassPlacements(createRng(7), 0, always, [])).toHaveLength(0);
    expect(grassPlacements(createRng(7), 5, always, [])).toHaveLength(5);
  });

  it('only accepts points that isOpen allows, asking with the 0.5 m clearance', () => {
    const radii = new Set<number>();
    // Open only in the east half.
    const isOpen = (x: number, _z: number, r: number): boolean => {
      radii.add(r);
      return x > 0;
    };
    const out = grassPlacements(createRng(7), 200, isOpen, []);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) expect(p.x).toBeGreaterThan(0);
    expect([...radii]).toEqual([0.5]);
  });

  it('places nothing when no point is open, and terminates', () => {
    expect(grassPlacements(createRng(7), 900, () => false, [])).toEqual([]);
  });

  it('keeps every tuft outside the zone exclusion (legacy d2 < 16, a 4 m radius)', () => {
    const out = grassPlacements(createRng(7), 900, always, ZONES);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      for (const zd of ZONES) {
        expect((p.x - zd.x) ** 2 + (p.z - zd.z) ** 2).toBeGreaterThanOrEqual(16);
      }
    }
  });

  it('gives scales inside the legacy ranges', () => {
    const out = grassPlacements(createRng(7), 900, always, []);
    for (const p of out) {
      expect(p.sx).toBeGreaterThanOrEqual(0.7);
      expect(p.sx).toBeLessThan(1.6);
      expect(p.sy).toBeGreaterThanOrEqual(0.7 * 0.8);
      expect(p.sy).toBeLessThan(1.6 * 1.4);
      expect(p.yaw).toBeGreaterThanOrEqual(0);
      expect(p.yaw).toBeLessThan(Math.PI * 2);
    }
  });

  it('is deterministic for createRng(7)', () => {
    const a = grassPlacements(createRng(7), 900, always, ZONES);
    const b = grassPlacements(createRng(7), 900, always, ZONES);
    expect(a).toEqual(b);
  });
});
