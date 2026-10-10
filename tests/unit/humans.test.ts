import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { animateHuman, makeHumanRig, placeHumanEnemy, type HumanPlaceState } from '../../src/render/humans';

const OPERATOR_COLOR = 0x2f6b8a;

// The torso is the only 0.75-high box in a body.
function torsoOf(group: THREE.Group): THREE.BoxGeometry {
  let found: THREE.Mesh | undefined;
  group.traverse((c) => {
    if (
      found === undefined &&
      c instanceof THREE.Mesh &&
      c.geometry instanceof THREE.BoxGeometry &&
      c.geometry.parameters.height === 0.75
    )
      found = c;
  });
  const mesh = found;
  if (!mesh) throw new Error('torso not found');
  return mesh.geometry as THREE.BoxGeometry;
}

function placeState(overrides: Partial<HumanPlaceState> = {}): HumanPlaceState {
  return {
    x: 0,
    z: 0,
    yaw: 0,
    kick: 0,
    crouch: 0,
    hiding: false,
    flinchT: 0,
    spot: 0,
    phase: 0,
    moving: false,
    alive: true,
    fall: 0,
    tumble: 1,
    time: 0,
    dt: 0.1,
    ...overrides,
  };
}

describe('makeHumanRig', () => {
  it('gives the heavy a wider torso (0.8)', () => {
    const heavy = makeHumanRig('heavy', 0x2c3a4f);
    const rifle = makeHumanRig('rifle', 0x56624f);
    expect(torsoOf(heavy.group).parameters.width).toBe(0.8);
    expect(torsoOf(rifle.group).parameters.width).toBe(0.52);
  });

  it('gives the sniper an 1.1-long rifle, others 0.75', () => {
    const sniper = makeHumanRig('sniper', 0x6b5b3a);
    const rifle = makeHumanRig('rifle', 0x56624f);
    const sniperGun = sniper.gun as THREE.Mesh;
    const rifleGun = rifle.gun as THREE.Mesh;
    expect((sniperGun.geometry as THREE.BoxGeometry).parameters.depth).toBe(1.1);
    expect((rifleGun.geometry as THREE.BoxGeometry).parameters.depth).toBe(0.75);
    expect(sniper.baseGunZ).toBe(0.5);
    expect(rifle.baseGunZ).toBe(0.4);
  });

  it('builds two legs, two arms, and a hidden marker', () => {
    const rig = makeHumanRig('grenadier', 0x5a3b3b);
    expect(rig.legs).toHaveLength(2);
    expect(rig.arms).toHaveLength(2);
    expect(rig.marker.visible).toBe(false);
    expect(rig.marker.castShadow).toBe(false);
    expect(rig.group.rotation.order).toBe('YXZ');
  });

  it('accepts the operator kind with the rifle silhouette and the given colour', () => {
    const op = makeHumanRig('operator', OPERATOR_COLOR);
    expect(torsoOf(op.group).parameters.width).toBe(0.52);
    expect((op.gun as THREE.Mesh).geometry).toBeDefined();
    expect(op.marker.visible).toBe(false);
  });

  it('shares geometry between rigs of the same kind and colour', () => {
    const a = makeHumanRig('rifle', 0x56624f);
    const b = makeHumanRig('rifle', 0x56624f);
    const c = makeHumanRig('rifle', 0x111111);
    expect((a.legs[0]?.children[0] as THREE.Mesh).geometry).toBe(
      (b.legs[0]?.children[0] as THREE.Mesh).geometry,
    );
    expect((a.legs[0]?.children[0] as THREE.Mesh).material).toBe(
      (b.legs[0]?.children[0] as THREE.Mesh).material,
    );
    expect((a.legs[0]?.children[0] as THREE.Mesh).material).not.toBe(
      (c.legs[0]?.children[0] as THREE.Mesh).material,
    );
  });
});

describe('animateHuman', () => {
  it('swings the legs while moving and returns an advanced phase', () => {
    const rig = makeHumanRig('rifle', 0x56624f);
    const phase = animateHuman(rig, { phase: 0, moving: true, aiming: false }, 0.1);
    expect(phase).toBeCloseTo(0.9, 10);
    expect(rig.legs[0]?.rotation.x).toBeCloseTo(Math.sin(0.9) * 0.6, 10);
    expect(rig.legs[1]?.rotation.x).toBeCloseTo(-Math.sin(0.9) * 0.6, 10);
  });

  it('leaves the legs at zero when standing still', () => {
    const rig = makeHumanRig('rifle', 0x56624f);
    const phase = animateHuman(rig, { phase: 0, moving: false, aiming: false }, 0.1);
    expect(phase).toBe(0);
    // Legacy negates the swing, so the right leg is -0 rather than +0.
    expect(rig.legs[0]?.rotation.x).toBeCloseTo(0, 12);
    expect(rig.legs[1]?.rotation.x).toBeCloseTo(0, 12);
  });

  it('raises the right arm toward -1.45 when aiming', () => {
    const rig = makeHumanRig('rifle', 0x56624f);
    animateHuman(rig, { phase: 0, moving: false, aiming: true }, 0.1);
    // lerp at min(1, 0.1 * 10) = 1 reaches the target in one step.
    expect(rig.arms[1]?.rotation.x).toBeCloseTo(-1.45, 10);
    expect(rig.arms[0]?.rotation.x).toBeCloseTo(-1.25, 10);
  });
});

describe('placeHumanEnemy', () => {
  it('falls over in 4 steps of dt 0.1 and reaches -PI/2', () => {
    const rig = makeHumanRig('rifle', 0x56624f);
    const state = placeState({ alive: false, tumble: -1 });
    placeHumanEnemy(rig, state);
    expect(state.fall).toBeCloseTo(0.3, 10);
    expect(rig.group.rotation.x).toBeCloseTo((-Math.PI / 2) * 0.3, 10);
    for (let i = 0; i < 3; i++) placeHumanEnemy(rig, state);
    expect(state.fall).toBe(1);
    expect(rig.group.rotation.x).toBeCloseTo(-Math.PI / 2, 10);
    expect(rig.group.position.y).toBeCloseTo(0.3, 10);
    expect(rig.group.rotation.z).toBeCloseTo(-0.5, 10);
  });

  it('shows the marker only while spot is above zero', () => {
    const rig = makeHumanRig('sniper', 0x6b5b3a);
    placeHumanEnemy(rig, placeState({ spot: 0 }));
    expect(rig.marker.visible).toBe(false);
    placeHumanEnemy(rig, placeState({ spot: 0.3, time: 2 }));
    expect(rig.marker.visible).toBe(true);
    expect(rig.marker.rotation.y).toBeCloseTo(6, 10);
  });

  it('decays gun recoil at dt * 8 and moves the gun back by kick * 0.12', () => {
    const rig = makeHumanRig('rifle', 0x56624f);
    const state = placeState({ kick: 1, dt: 0.05 });
    placeHumanEnemy(rig, state);
    expect(state.kick).toBeCloseTo(1 - 0.05 * 8, 10);
    expect(rig.gun.position.z).toBeCloseTo(rig.baseGunZ - state.kick * 0.12, 10);
  });

  it('crouches toward 1 when hiding, scaling the body down by up to 28 percent', () => {
    const rig = makeHumanRig('heavy', 0x2c3a4f);
    const state = placeState({ hiding: true, dt: 0.1 });
    placeHumanEnemy(rig, state);
    expect(state.crouch).toBeCloseTo(0.7, 10);
    expect(rig.group.scale.y).toBeCloseTo(1 - 0.28 * 0.7, 10);
  });

  it('pushes the body back along yaw by flinchT * 2.5', () => {
    const rig = makeHumanRig('rifle', 0x56624f);
    placeHumanEnemy(rig, placeState({ x: 1, z: 2, yaw: 0, flinchT: 0.12 }));
    expect(rig.group.position.x).toBeCloseTo(1, 10);
    expect(rig.group.position.z).toBeCloseTo(2 - 0.3, 10);
  });
});
