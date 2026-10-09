import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createRng, type Rng } from '../../src/core/rng';
import { RainField, buildRain } from '../../src/render/rain';

// An Rng whose every draw is the same value. Used to place every streak at a known height.
function constantRng(v: number): Rng {
  const rng: Rng = {
    next: () => v,
    range: (a, b) => a + (b - a) * v,
    pick<T>(items: readonly T[]): T {
      const item = items[Math.floor(v * items.length)];
      if (item === undefined) throw new RangeError('pick() requires a non-empty array');
      return item;
    },
    fork: () => rng,
  };
  return rng;
}

describe('RainField', () => {
  it('holds two points per streak, so the positions buffer is count * 6 floats', () => {
    expect(new RainField(createRng(7)).positions).toHaveLength(600 * 6);
    expect(new RainField(createRng(7), 10).positions).toHaveLength(60);
    expect(new RainField(createRng(7), 10).count).toBe(10);
  });

  it('wraps a streak at y = 0.1 back near the ceiling after dt = 0.02', () => {
    // 0.1 / 22 as the draw gives initial y = 0.1 for every streak.
    const field = new RainField(constantRng(0.1 / 22), 1);
    expect(field.positions[1]).toBeCloseTo(0.1, 6);

    field.update(0.02, 0, 0);

    // 0.1 - 16 * 0.02 = -0.22, then + 22 = 21.78.
    const y = field.positions[1] ?? NaN;
    expect(y).toBeGreaterThan(21);
    expect(y).toBeLessThan(22);
    expect(y).toBeCloseTo(21.78, 4);
    // The second point of the streak sits 0.55 m above the first.
    expect(field.positions[4]).toBeCloseTo(y + 0.55, 4);
  });

  it('falls a streak that stays above 0 by exactly 16 m/s * dt', () => {
    const field = new RainField(constantRng(0.5), 1);
    const y0 = field.positions[1] ?? NaN;
    field.update(0.1, 0, 0);
    expect(field.positions[1]).toBeCloseTo(y0 - 1.6, 4);
  });

  it('keeps every streak height inside [0, 22) after many updates', () => {
    const field = new RainField(createRng(7), 600);
    for (let frame = 0; frame < 300; frame++) {
      field.update(1 / 60, frame * 0.1, -frame * 0.05);
    }
    for (let i = 0; i < field.count; i++) {
      const y = field.positions[i * 6 + 1] ?? NaN;
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(22);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = new RainField(createRng(7), 600);
    const b = new RainField(createRng(7), 600);
    expect(a.positions).toEqual(b.positions);
    for (let frame = 0; frame < 120; frame++) {
      a.update(0.02, 3, -4);
      b.update(0.02, 3, -4);
    }
    expect(a.positions).toEqual(b.positions);
  });

  it('follows the player: streak x and z are offset from the spawn box by the player position', () => {
    const still = new RainField(createRng(7), 50);
    const moved = new RainField(createRng(7), 50);
    still.update(0, 0, 0);
    moved.update(0, 10, -5);
    for (let i = 0; i < 50; i++) {
      expect(moved.positions[i * 6]).toBeCloseTo((still.positions[i * 6] ?? NaN) + 10, 4);
      expect(moved.positions[i * 6 + 2]).toBeCloseTo((still.positions[i * 6 + 2] ?? NaN) - 5, 4);
    }
  });
});

describe('buildRain', () => {
  it('starts hidden, is never frustum-culled, and toggles visibility', () => {
    const scene = new THREE.Scene();
    const field = new RainField(createRng(7), 600);
    const rain = buildRain(scene, field);
    expect(rain.object.visible).toBe(false);
    expect(rain.object.frustumCulled).toBe(false);
    expect(scene.children).toContain(rain.object);
    rain.setVisible(true);
    expect(rain.object.visible).toBe(true);
    rain.setVisible(false);
    expect(rain.object.visible).toBe(false);
  });

  it('shares the field positions with the geometry, so updates reach the GPU buffer', () => {
    const scene = new THREE.Scene();
    const field = new RainField(createRng(7), 10);
    const rain = buildRain(scene, field);
    const attr = rain.object.geometry.getAttribute('position');
    expect(attr.count).toBe(20);
    expect(attr.array).toBe(field.positions);
  });
});
