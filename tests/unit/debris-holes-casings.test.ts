import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createRng } from '../../src/core/rng';
import type { Rng } from '../../src/core/rng';
import { DebrisField, buildDebrisMeshes } from '../../src/render/debris';
import { HoleField, buildHoleMeshes } from '../../src/render/holes';
import { CasingField } from '../../src/render/casings';

// Every draw returns the same value, so the outputs are predictable.
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

describe('DebrisField', () => {
  it('caps at 90 and drops the oldest pieces first', () => {
    const field = new DebrisField();
    const rng = createRng(3);
    field.burst({ x: -50, y: 1, z: 0 }, 10, rng);
    field.burst({ x: 0, y: 1, z: 0 }, 90, rng);
    expect(field.items.length).toBe(90);
    expect(field.items.every((d) => d.pos.x !== -50)).toBe(true);
  });

  it('gives pieces a scale in [0.5, 1.5) and a life in [1.4, 2.2)', () => {
    const field = new DebrisField();
    field.burst({ x: 0, y: 1, z: 0 }, 50, createRng(11));
    for (const d of field.items) {
      expect(d.scale).toBeGreaterThanOrEqual(0.5);
      expect(d.scale).toBeLessThan(1.5);
      expect(d.life).toBeGreaterThanOrEqual(1.4);
      expect(d.life).toBeLessThan(2.2);
    }
  });

  it('drops vertical velocity by 16 m/s per second under gravity', () => {
    const field = new DebrisField();
    field.burst({ x: 0, y: 3, z: 0 }, 1, constantRng(0.5));
    const before = field.items[0]?.vel.y ?? NaN;
    field.update(0.1);
    expect(field.items[0]?.vel.y).toBeCloseTo(before - 1.6, 9);
  });

  it('keeps pieces above the floor at y 0.07 and removes them after their life', () => {
    const field = new DebrisField();
    field.burst({ x: 0, y: 0.1, z: 0 }, 5, createRng(5));
    for (let i = 0; i < 60; i++) {
      field.update(1 / 60);
      for (const d of field.items) expect(d.pos.y).toBeGreaterThanOrEqual(0.07);
    }
    field.update(2.5);
    expect(field.items.length).toBe(0);
  });
});

describe('HoleField', () => {
  it('offsets the decal off the surface and aims it at p - dir', () => {
    const field = new HoleField();
    field.add({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 1 });
    const hole = field.items[0];
    expect(hole?.pos.x).toBeCloseTo(1, 9);
    expect(hole?.pos.y).toBeCloseTo(2, 9);
    expect(hole?.pos.z).toBeCloseTo(2.98, 9);
    expect(hole?.target).toEqual({ x: 1, y: 2, z: 2 });
  });

  it('caps at 80 and removes the oldest hole', () => {
    const field = new HoleField();
    for (let i = 0; i < 81; i++) {
      field.add({ x: i, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    }
    expect(field.items.length).toBe(80);
    expect(field.items[0]?.pos.x).toBe(1);
    expect(field.items[79]?.pos.x).toBe(80);
  });
});

describe('CasingField', () => {
  it('caps at 24 and removes the oldest casing', () => {
    const field = new CasingField();
    const rng = createRng(8);
    for (let i = 0; i < 30; i++) {
      field.eject({ x: i, y: 1.5, z: 0 }, 0, rng);
    }
    expect(field.items.length).toBe(24);
    expect(field.items[0]?.pos.x).toBeCloseTo(6 - 0.18, 9);
  });

  it('ejects to the right of the yaw with the legacy velocity and offset', () => {
    const field = new CasingField();
    field.eject({ x: 0, y: 1.6, z: 0 }, 0, constantRng(0.5));
    const c = field.items[0];
    // yaw 0: rx = -1, rz = 0. Offset: x -0.18, y -0.12.
    expect(c?.pos.x).toBeCloseTo(-0.18, 9);
    expect(c?.pos.y).toBeCloseTo(1.48, 9);
    expect(c?.pos.z).toBeCloseTo(0, 9);
    // vx = -(1.6 + 0.5) = -2.1, vy = 1.8 + 0.5 * 0.8 = 2.2, vz = 0.
    expect(c?.vel.x).toBeCloseTo(-2.1, 9);
    expect(c?.vel.y).toBeCloseTo(2.2, 9);
    expect(c?.vel.z).toBeCloseTo(0, 9);
  });

  it('expires after 1.4 s', () => {
    const field = new CasingField();
    field.eject({ x: 0, y: 1, z: 0 }, 0, constantRng(0.5));
    field.update(1.39);
    expect(field.items.length).toBe(1);
    field.update(0.02);
    expect(field.items.length).toBe(0);
  });

  it('bounces off the floor at y 0.02 with damped velocity', () => {
    const field = new CasingField();
    // Origin 0.1 places the casing at y -0.02, below the floor.
    field.eject({ x: 0, y: 0.1, z: 0 }, 0, constantRng(0.5));
    field.update(0.001);
    const c = field.items[0];
    expect(c?.pos.y).toBeCloseTo(0.02, 9);
    expect(c?.vel.y).toBeLessThan(0);
  });
});

describe('debris and hole meshes', () => {
  it('draws the live debris pieces as one instanced mesh, hides it when empty and disposes cleanly', () => {
    const scene = new THREE.Scene();
    const field = new DebrisField();
    const handle = buildDebrisMeshes(scene, field);
    const mesh = scene.children[0] as THREE.InstancedMesh;
    expect(scene.children.length).toBe(1);
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.visible).toBe(false);

    field.burst({ x: 0, y: 1, z: 0 }, 3, constantRng(0.5));
    handle.sync();
    expect(mesh.visible).toBe(true);
    expect(mesh.count).toBe(3);

    field.update(2.5);
    handle.sync();
    expect(mesh.visible).toBe(false);
    expect(mesh.count).toBe(0);

    field.burst({ x: 0, y: 1, z: 0 }, 1, constantRng(0.5));
    handle.sync();
    expect(mesh.count).toBe(1);
    expect(scene.children.length).toBe(1);

    handle.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('draws every hole decal in one instanced mesh, drops the oldest past the cap, and builds the texture once', () => {
    const scene = new THREE.Scene();
    const field = new HoleField();
    let textures = 0;
    const handle = buildHoleMeshes(scene, field, () => {
      textures++;
      return new THREE.Texture();
    });

    handle.sync();
    expect(textures).toBe(0);
    expect(scene.children.length).toBe(0);

    for (let i = 0; i < 81; i++) {
      field.add({ x: i, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    }
    handle.sync();
    expect(scene.children.length).toBe(1);
    expect((scene.children[0] as THREE.InstancedMesh).count).toBe(80);
    expect(textures).toBe(1);

    // No new hole: no rebuild and no second texture.
    handle.sync();
    expect(textures).toBe(1);

    handle.dispose();
    expect(scene.children.length).toBe(0);
  });
});
