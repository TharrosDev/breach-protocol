import { describe, it, expect } from 'vitest';
import { WEAPONS } from '../../src/content/weapons';
import { falloff, hitDamage, spreadFor } from '../../src/sim/ballistics';

const base = { spread: 0.02, ads: false, moving: false, sprinting: false, reflex: false };

describe('falloff', () => {
  it('is full damage up to half range', () => {
    expect(falloff(0, 200)).toBe(1);
    expect(falloff(100, 200)).toBe(1);
  });

  it('falls linearly to 0.7 at range', () => {
    expect(falloff(150, 200)).toBeCloseTo(0.85, 10);
    expect(falloff(200, 200)).toBeCloseTo(0.7, 10);
  });

  it('stays clamped at 0.7 beyond range', () => {
    expect(falloff(500, 200)).toBeCloseTo(0.7, 10);
  });
});

describe('hitDamage', () => {
  it('VX headshot at 0 m is 60', () => {
    expect(hitDamage(WEAPONS.vx, 0, true)).toBeCloseTo(60, 10);
  });

  it('Breaker pellet at 45 m is 11 x 0.7', () => {
    expect(hitDamage(WEAPONS.bk, 45, false)).toBeCloseTo(7.7, 10);
  });

  it('body shot does not use headMul', () => {
    expect(hitDamage(WEAPONS.vx, 0, false)).toBeCloseTo(24, 10);
  });
});

describe('spreadFor', () => {
  it('returns the base spread with no modifiers', () => {
    expect(spreadFor(WEAPONS.vx, base)).toBeCloseTo(0.02, 10);
  });

  it('ADS multiplier is 0.55', () => {
    expect(spreadFor(WEAPONS.vx, { ...base, ads: true })).toBeCloseTo(0.02 * 0.55, 10);
  });

  it('moving multiplier is 1.35', () => {
    expect(spreadFor(WEAPONS.vx, { ...base, moving: true })).toBeCloseTo(0.02 * 1.35, 10);
  });

  it('sprinting multiplier is 2', () => {
    expect(spreadFor(WEAPONS.vx, { ...base, sprinting: true })).toBeCloseTo(0.04, 10);
  });

  it('reflex multiplier is 0.85', () => {
    expect(spreadFor(WEAPONS.vx, { ...base, reflex: true })).toBeCloseTo(0.02 * 0.85, 10);
  });

  it('all modifiers multiply together', () => {
    const all = { ...base, ads: true, moving: true, sprinting: true, reflex: true };
    expect(spreadFor(WEAPONS.vx, all)).toBeCloseTo(0.02 * 0.55 * 1.35 * 2 * 0.85, 10);
  });
});
