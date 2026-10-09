import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Rng } from '../../src/core/rng';
import { createRng } from '../../src/core/rng';
import { ParticlePool, buildParticles } from '../../src/render/particles';
import {
  ShockwaveField,
  TracerPool,
  buildShockwaveMeshes,
  buildTracerMeshes,
  shockwaveAt,
  tracerSegment,
} from '../../src/render/tracers';

// Every draw returns the same value, so the direction and speed of each particle are known exactly.
// With 0.5: angle PI, vertical component 0, speed = speed * 0.7.
function constantRng(value: number): Rng {
  const rng: Rng = {
    next: () => value,
    range: (a, b) => a + (b - a) * value,
    pick: <T>(items: readonly T[]): T => {
      const item = items[0];
      if (item === undefined) throw new RangeError('empty');
      return item;
    },
    fork: () => rng,
  };
  return rng;
}

const ORIGIN = { x: 0, y: 5, z: 0 };

describe('ParticlePool emitBurst', () => {
  it('emits n live particles that expire at the given life', () => {
    const pool = new ParticlePool(50);
    pool.emitBurst(ORIGIN, 10, 4, 0xffffff, 0.5, 0, createRng(7));
    expect(pool.alive).toBe(10);

    pool.update(0.49);
    expect(pool.alive).toBe(10);

    pool.update(0.02);
    expect(pool.alive).toBe(0);
  });

  it('ignores a burst with non-positive life', () => {
    const pool = new ParticlePool(10);
    pool.emitBurst(ORIGIN, 5, 4, 0xffffff, 0, 0, createRng(1));
    expect(pool.alive).toBe(0);
  });

  it('caps at max and overwrites the oldest slots in a ring', () => {
    const pool = new ParticlePool(4);
    expect(pool.positions.length).toBe(12);
    pool.emitBurst(ORIGIN, 4, 1, 0xffffff, 1, 0, createRng(2));
    expect(pool.alive).toBe(4);

    pool.emitBurst(ORIGIN, 2, 1, 0xffffff, 5, 0, createRng(3));
    expect(pool.alive).toBe(4);

    pool.update(1.5);
    expect(pool.alive).toBe(2);
  });

  it('keeps 500 particles by default', () => {
    const pool = new ParticlePool();
    pool.emitBurst(ORIGIN, 1000, 4, 0xffffff, 1, 0, createRng(4));
    expect(pool.alive).toBe(500);
    expect(pool.positions.length).toBe(1500);
  });

  it('stores the base colour in linear space, matching THREE.Color(hex)', () => {
    const pool = new ParticlePool(2);
    pool.emitBurst(ORIGIN, 1, 0, 0xffffff, 1, 0, constantRng(0.5));
    expect(pool.colors[0]).toBeCloseTo(1, 6);
    expect(pool.colors[1]).toBeCloseTo(1, 6);
    expect(pool.colors[2]).toBeCloseTo(1, 6);

    pool.emitBurst(ORIGIN, 1, 0, 0x808080, 1, 0, constantRng(0.5));
    // sRGB 0x80 is about 0.2158 in linear space.
    expect(pool.colors[3]).toBeCloseTo(0.2158, 3);
  });
});

describe('ParticlePool update', () => {
  it('moves particles with gravity and drag, then integrates the dragged velocity', () => {
    const pool = new ParticlePool(2);
    // Speed 10, direction (-1, 0, 0) after the constant draw, so the initial velocity is (-7, 0, 0).
    pool.emitBurst(ORIGIN, 1, 10, 0xffffff, 2, 0, constantRng(0.5));

    pool.update(0.1);
    // Gravity: vy = -0.9. Drag factor 0.75: vx = -5.25, vy = -0.675, vz = 0.
    expect(pool.positions[0]).toBeCloseTo(-0.525, 6);
    expect(pool.positions[1]).toBeCloseTo(5 - 0.0675, 6);
    expect(pool.positions[2]).toBeCloseTo(0, 6);
  });

  it('bounces off the floor at y 0.02 with damped vertical velocity', () => {
    const pool = new ParticlePool(2);
    pool.emitBurst({ x: 0, y: 0.05, z: 0 }, 1, 0, 0xffffff, 2, -6, constantRng(0.5));
    pool.update(0.1);
    expect(pool.positions[1]).toBeCloseTo(0.02, 6);
  });

  it('parks dead particles at y -1000 with zero colour', () => {
    const pool = new ParticlePool(2);
    pool.emitBurst(ORIGIN, 1, 4, 0xffffff, 0.1, 0, createRng(9));
    pool.update(0.2);
    expect(pool.alive).toBe(0);
    expect(pool.positions[1]).toBe(-1000);
    expect(pool.colors[0]).toBe(0);
    expect(pool.colors[1]).toBe(0);
    expect(pool.colors[2]).toBe(0);
  });

  it('fades colour with remaining life', () => {
    const pool = new ParticlePool(2);
    pool.emitBurst(ORIGIN, 1, 0, 0xffffff, 1, 0, constantRng(0.5));
    pool.update(0.25);
    expect(pool.colors[0]).toBeCloseTo(0.75, 6);
  });
});

describe('buildParticles', () => {
  it('adds one Points object that shares the pool buffers', () => {
    const scene = new THREE.Scene();
    const pool = new ParticlePool(8);
    const handle = buildParticles(scene, pool);

    expect(scene.children).toContain(handle.object);
    expect(handle.object.frustumCulled).toBe(false);
    const attr = handle.object.geometry.getAttribute('position');
    expect(attr.array).toBe(pool.positions);

    expect(() => {
      handle.sync();
    }).not.toThrow();
  });
});

describe('tracers', () => {
  it('builds a segment with the legacy colour and 0.06 s life', () => {
    const seg = tracerSegment({ x: 0, y: 1, z: 0 }, { x: 5, y: 1, z: 0 });
    expect(seg.color).toBe(0xffe7a0);
    expect(seg.life).toBe(0.06);
    expect(seg.end.x).toBe(5);
  });

  it('expires a tracer after 0.06 s', () => {
    const pool = new TracerPool();
    pool.add(tracerSegment({ x: 0, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }));
    expect(pool.items.length).toBe(1);

    pool.update(0.05);
    expect(pool.items.length).toBe(1);

    pool.update(0.02);
    expect(pool.items.length).toBe(0);
  });
});

describe('ShockwaveField', () => {
  it('grows the scale and fades the opacity over 0.45 s', () => {
    const field = new ShockwaveField();
    field.add({ x: 1, y: 0, z: 2 }, 4);
    const first = field.items[0];
    expect(first?.scale).toBeCloseTo(0.5, 6);
    expect(first?.opacity).toBeCloseTo(0.8, 6);

    field.update(0.225);
    expect(field.items[0]?.scale).toBeCloseTo(2.5, 6);
    expect(field.items[0]?.opacity).toBeCloseTo(0.4, 6);

    field.update(0.2249);
    expect(field.items[0]?.opacity).toBeLessThan(0.4);
    expect(field.items[0]?.scale).toBeGreaterThan(2.5);
  });

  it('reaches zero opacity at life end and removes the ring', () => {
    expect(shockwaveAt(1, 4).opacity).toBe(0);
    expect(shockwaveAt(1, 4).scale).toBeCloseTo(4.5, 6);

    const field = new ShockwaveField();
    field.add({ x: 0, y: 0, z: 0 }, 4);
    field.update(0.44);
    expect(field.items[0]?.opacity).toBeLessThan(0.02);

    field.update(0.02);
    expect(field.items.length).toBe(0);
  });
});

describe('tracer and shockwave meshes', () => {
  it('adds a line per live tracer and removes it on expiry', () => {
    const scene = new THREE.Scene();
    const pool = new TracerPool();
    const handle = buildTracerMeshes(scene, pool);

    pool.add(tracerSegment({ x: 0, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }));
    handle.sync();
    expect(scene.children.length).toBe(1);
    expect(scene.children[0]).toBeInstanceOf(THREE.Line);

    pool.update(0.06);
    handle.sync();
    expect(scene.children.length).toBe(0);
    handle.dispose();
  });

  it('adds a ring per shockwave and removes it at life end', () => {
    const scene = new THREE.Scene();
    const field = new ShockwaveField();
    const handle = buildShockwaveMeshes(scene, field);

    field.add({ x: 0, y: 0, z: 0 }, 4);
    handle.sync();
    expect(scene.children.length).toBe(1);

    field.update(0.2);
    handle.sync();
    const ring = scene.children[0];
    expect(ring?.position.y).toBeCloseTo(0.12, 9);
    expect(ring?.scale.x).toBeCloseTo(0.5 + (0.2 / 0.45) * 4, 6);

    field.update(0.3);
    handle.sync();
    expect(scene.children.length).toBe(0);
    handle.dispose();
  });
});
