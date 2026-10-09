import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyLook, createViewmodel, gunPose, isScoped, stepViewmodel } from '../../src/render/viewmodel';
import { GUN_PARTS, buildGunModel } from '../../src/render/gun-models';

const DT = 1 / 60;

describe('viewmodel spring', () => {
  it('settles onto its target after 2 s at 60 Hz', () => {
    const vm = createViewmodel();
    applyLook(vm, -50, 30); // tx = 0.045, ty = 0.027
    let peakX = 0;
    for (let i = 0; i < 120; i++) {
      stepViewmodel(vm, DT, 0);
      peakX = Math.max(peakX, Math.abs(vm.x));
    }
    // The spring actually moved toward the target before settling.
    expect(peakX).toBeGreaterThan(0.01);
    expect(Math.abs(vm.x - vm.tx)).toBeLessThan(1e-3);
    expect(Math.abs(vm.y - vm.ty)).toBeLessThan(1e-3);
  });

  it('target decays toward zero at rate exp(-9 t)', () => {
    const vm = createViewmodel();
    applyLook(vm, -100, 0); // tx = 0.09
    stepViewmodel(vm, DT, 0);
    expect(vm.tx).toBeCloseTo(0.09 * Math.exp(-9 * DT), 12);
  });

  it('gun kick decays at 9 per second and stops at zero', () => {
    const vm = createViewmodel();
    vm.gunKick = 1;
    stepViewmodel(vm, 0.05, 0);
    expect(vm.gunKick).toBeCloseTo(1 - 0.05 * 9, 12);
    for (let i = 0; i < 60; i++) stepViewmodel(vm, DT, 0);
    expect(vm.gunKick).toBe(0);
  });
});

describe('applyLook', () => {
  it('clamps the target to +-0.09 in x and +-0.07 in y', () => {
    const vm = createViewmodel();
    applyLook(vm, 1e4, 1e4);
    expect(vm.tx).toBe(-0.09);
    expect(vm.ty).toBe(0.07);
    applyLook(vm, -1e4, -1e4);
    expect(vm.tx).toBe(0.09);
    expect(vm.ty).toBe(-0.07);
  });

  it('moves the target by movement * 0.0009 inside the clamp', () => {
    const vm = createViewmodel();
    applyLook(vm, 10, -10);
    expect(vm.tx).toBeCloseTo(-0.009, 12);
    expect(vm.ty).toBeCloseTo(-0.009, 12);
  });
});

describe('reload bump', () => {
  it('rises to 1 at reloadProgress 0.3 and returns to 0 at 1.0', () => {
    const vm = createViewmodel();
    for (let i = 0; i < 60; i++) stepViewmodel(vm, DT, 0.3);
    expect(vm.rlAnim).toBeCloseTo(1, 4);
    for (let i = 0; i < 60; i++) stepViewmodel(vm, DT, 1);
    expect(vm.rlAnim).toBeLessThan(1e-4);
  });

  it('holds at 1 through the middle of the reload', () => {
    const vm = createViewmodel();
    for (let i = 0; i < 60; i++) stepViewmodel(vm, DT, 0.5);
    expect(vm.rlAnim).toBeCloseTo(1, 4);
  });
});

describe('gunPose', () => {
  // A known input, checked against index.html:1899-1918 written out by hand.
  const vm = {
    x: 0.02,
    vx: 0,
    y: 0.01,
    vy: 0,
    tx: 0,
    ty: 0,
    rlAnim: 0.5,
    gunKick: 1,
    meleeT: 0.15,
  };

  it('matches the legacy formulas at adsT 0', () => {
    const pose = gunPose(vm, {
      adsT: 0,
      moving: true,
      bobT: 0.5,
      switchT: 0.175,
      reloadProgress: 0,
    });
    const bx = Math.cos(0.25) * 0.012;
    const by = Math.abs(Math.sin(0.5)) * 0.012;
    const mel = 1; // sin((1 - 0.15 / 0.3) * PI)
    expect(pose.position[0]).toBeCloseTo(0.24 + bx + 0.02, 10);
    expect(pose.position[1]).toBeCloseTo(-0.2 - 0.5 * 0.25 - by + 0.01 - 0.125, 10);
    expect(pose.position[2]).toBeCloseTo(-0.45 + 1 * 0.05 - mel * 0.18, 10);
    expect(pose.rotation[0]).toBeCloseTo(1 * 0.05 + 0.5 * 0.3 + mel * 0.5, 10);
    expect(pose.rotation[2]).toBeCloseTo(0.5 * 0.22, 10);
    expect(pose.magY).toBeCloseTo(-0.11 - 0.5 * 0.32, 10);
  });

  it('matches the legacy formulas at adsT 1', () => {
    const pose = gunPose(vm, {
      adsT: 1,
      moving: true,
      bobT: 0.5,
      switchT: 0,
      reloadProgress: 0,
    });
    const bobAmt = 1 * (1 - 0.8);
    const bx = Math.cos(0.25) * 0.012 * bobAmt;
    const by = Math.abs(Math.sin(0.5)) * 0.012 * bobAmt;
    const sway = 0.02 * (1 - 0.7);
    expect(pose.position[0]).toBeCloseTo(0 + bx + sway, 10);
    expect(pose.position[1]).toBeCloseTo(-0.14 - 0.5 * 0.25 - by + 0.01 * 0.3, 10);
    expect(pose.position[2]).toBeCloseTo(-0.34 + 0.05 - 0.18, 10);
  });

  it('has no bob and no sway at rest with ADS fully up and no look offset', () => {
    const still = { ...createViewmodel(), gunKick: 0 };
    const pose = gunPose(still, { adsT: 1, moving: false, bobT: 1, switchT: 0, reloadProgress: 0 });
    expect(pose.position[0]).toBeCloseTo(0, 12);
    expect(pose.position[1]).toBeCloseTo(-0.14, 12);
    expect(pose.position[2]).toBeCloseTo(-0.34, 12);
  });
});

describe('isScoped', () => {
  it('is true only for the DMR above 0.9 ADS', () => {
    expect(isScoped('dm', 0.95)).toBe(true);
    expect(isScoped('dm', 0.9)).toBe(false);
    expect(isScoped('dm', 0.5)).toBe(false);
    expect(isScoped('vx', 0.95)).toBe(false);
    expect(isScoped('vp', 1)).toBe(false);
  });
});

describe('buildGunModel', () => {
  it('places the muzzle at -L2 - b (vx: -1.1)', () => {
    const model = buildGunModel('vx');
    expect(model.muzzleZ).toBeCloseTo(-1.1, 10);
  });

  it('uses the legacy length for the pistol', () => {
    // L2 = 0.25 + 0.35 * 0.45, b = 0.15 + 0.35 * 0.25
    const model = buildGunModel('vp');
    expect(model.muzzleZ).toBeCloseTo(-(0.25 + 0.35 * 0.45) - (0.15 + 0.35 * 0.25), 10);
  });

  it('returns the magazine as a child of the group', () => {
    const model = buildGunModel('lm');
    expect(model.group).toBeInstanceOf(THREE.Group);
    expect(model.group.children).toContain(model.mag);
  });

  it('adds the DMR scope cylinder only for dm', () => {
    const hasCylinder = (group: THREE.Group): boolean =>
      group.children.some(
        (child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.CylinderGeometry,
      );
    expect(hasCylinder(buildGunModel('dm').group)).toBe(true);
    expect(hasCylinder(buildGunModel('vx').group)).toBe(false);
  });

  it('keeps the legacy colour for each weapon', () => {
    expect(GUN_PARTS.vx.color).toBe(0x30363f);
    expect(GUN_PARTS.vp.color).toBe(0x3a2e2a);
  });

  it('throws for an unknown id', () => {
    expect(() => buildGunModel('nope')).toThrow(/Unknown gun id/);
  });
});
