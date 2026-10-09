import { describe, it, expect } from 'vitest';
import { GADGETS } from '../../src/content/gadgets';
import { GADGET_IDS } from '../../src/content/ids';
import type { Enemy } from '../../src/sim/entities';
import type { EnemyKindId } from '../../src/content/enemies';
import { createGadgetSlot, useGadget, type GadgetSlot, type GadgetUser } from '../../src/sim/gadgets';
import { launchDrone, stepDrone, DRONE_LIFE } from '../../src/sim/drone';

function makeEnemy(kind: EnemyKindId, x: number, z: number, hp: number): Enemy {
  return {
    path: null,
    pathIdx: 0,
    pathT: 0,
    pathTx: 0,
    pathTz: 0,
    stuckT: 0,
    unstuck: 0,
    sideX: 0,
    sideZ: 0,
    kind,
    alive: true,
    hp,
    maxHp: hp,
    pos: { x, z },
    yaw: 0,
    state: 'guard',
    home: null,
    lastSeen: null,
    sight: 50,
    role: 'push',
    flankSide: 1,
    fireT: 0,
    blind: 0,
    coverT: 0,
    grenT: 0,
    cover: null,
    engaged: false,
    unseenT: 0,
    flinchT: 0,
    strafeT: 0,
    strafeDir: 1,
    moving: false,
    phase: 0,
    deathT: 0,
    spot: 0,
    gx: 0,
    gz: 0,
    kick: 0,
    crouch: 0,
  };
}

const EYE = { x: 0, y: 1.5, z: 0 };
const AIM = { x: 0, y: 0, z: 1 };

function alivePlayer(hp = 100): GadgetUser {
  return { hp, alive: true };
}

describe('gadget definitions', () => {
  it('matches the legacy uses and names', () => {
    expect(GADGET_IDS).toEqual(['frag', 'flash', 'smoke', 'medkit', 'drone']);
    expect(GADGETS.frag).toMatchObject({ name: 'Frag', uses: 2 });
    expect(GADGETS.flash).toMatchObject({ name: 'Flashbang', uses: 2 });
    expect(GADGETS.smoke).toMatchObject({ name: 'Smoke', uses: 2 });
    expect(GADGETS.medkit).toMatchObject({ name: 'Medkit', uses: 2 });
    expect(GADGETS.drone).toMatchObject({ name: 'Recon Drone', uses: 1 });
    expect(GADGETS.medkit.desc).toBe('Restores 50 health.');
  });

  it('starts each slot at its definition uses', () => {
    expect(createGadgetSlot('drone')).toEqual({ id: 'drone', uses: 1 });
    expect(createGadgetSlot('frag')).toEqual({ id: 'frag', uses: 2 });
  });
});

describe('useGadget: throwables', () => {
  it('throws a frag from the eye with legacy start, velocity and fuse, and spends one use', () => {
    const slots: GadgetSlot[] = [createGadgetSlot('frag'), createGadgetSlot('smoke')];
    const r = useGadget(slots, 0, alivePlayer(), EYE, AIM, null);
    expect(r.used).toBe(true);
    if (!r.used || r.kind !== 'grenade') throw new Error('expected a grenade');
    expect(r.grenade.owner).toBe('player');
    expect(r.grenade.kind).toBe('frag');
    expect(r.grenade.pos).toEqual({ x: 0, y: 1.5, z: 0.5 });
    expect(r.grenade.vel).toEqual({ x: 0, y: 3, z: 14 });
    expect(r.grenade.fuse).toBe(2.4);
    expect(slots[0]?.uses).toBe(1);
  });

  it('uses the smoke and flash fuses', () => {
    const slots: GadgetSlot[] = [createGadgetSlot('smoke'), createGadgetSlot('flash')];
    const s = useGadget(slots, 0, alivePlayer(), EYE, AIM, null);
    const f = useGadget(slots, 1, alivePlayer(), EYE, AIM, null);
    if (!s.used || s.kind !== 'grenade' || !f.used || f.kind !== 'grenade')
      throw new Error('expected grenades');
    expect(s.grenade.fuse).toBe(1.6);
    expect(f.grenade.fuse).toBe(1.4);
  });

  it('has two uses for each throwable, then ignores the slot at zero', () => {
    const slots: GadgetSlot[] = [createGadgetSlot('frag'), createGadgetSlot('flash')];
    expect(useGadget(slots, 0, alivePlayer(), EYE, AIM, null).used).toBe(true);
    expect(useGadget(slots, 0, alivePlayer(), EYE, AIM, null).used).toBe(true);
    expect(slots[0]?.uses).toBe(0);
    expect(useGadget(slots, 0, alivePlayer(), EYE, AIM, null)).toEqual({ used: false });
    expect(slots[0]?.uses).toBe(0);
  });

  it('ignores a use at zero uses without changing anything', () => {
    const slots: GadgetSlot[] = [{ id: 'smoke', uses: 0 }, createGadgetSlot('flash')];
    expect(useGadget(slots, 0, alivePlayer(), EYE, AIM, null)).toEqual({ used: false });
    expect(slots[0]?.uses).toBe(0);
  });
});

describe('useGadget: gating', () => {
  it('ignores every use while the player is dead', () => {
    const slots: GadgetSlot[] = [createGadgetSlot('frag'), createGadgetSlot('medkit')];
    const dead: GadgetUser = { hp: 0, alive: false };
    expect(useGadget(slots, 0, dead, EYE, AIM, null)).toEqual({ used: false });
    expect(useGadget(slots, 1, dead, EYE, AIM, null)).toEqual({ used: false });
    expect(slots[0]?.uses).toBe(2);
    expect(slots[1]?.uses).toBe(2);
  });

  it('ignores a slot index other than 0 or 1', () => {
    const slots: GadgetSlot[] = [createGadgetSlot('frag'), createGadgetSlot('flash')];
    expect(useGadget(slots, 2 as unknown as 0, alivePlayer(), EYE, AIM, null)).toEqual({ used: false });
    expect(slots.map((s) => s.uses)).toEqual([2, 2]);
  });
});

describe('useGadget: medkit', () => {
  it('restores 50 hp', () => {
    const slots: GadgetSlot[] = [createGadgetSlot('medkit'), createGadgetSlot('frag')];
    const p = alivePlayer(40);
    const r = useGadget(slots, 0, p, EYE, AIM, null);
    expect(r).toEqual({ used: true, kind: 'medkit', healed: 50 });
    expect(p.hp).toBe(90);
    expect(slots[0]?.uses).toBe(1);
  });

  it('caps hp at 100', () => {
    const slots: GadgetSlot[] = [createGadgetSlot('medkit'), createGadgetSlot('frag')];
    const p = alivePlayer(80);
    const r = useGadget(slots, 0, p, EYE, AIM, null);
    expect(r).toEqual({ used: true, kind: 'medkit', healed: 20 });
    expect(p.hp).toBe(100);
  });

  it('is ignored at full health and keeps its use', () => {
    const slots: GadgetSlot[] = [createGadgetSlot('medkit'), createGadgetSlot('frag')];
    const p = alivePlayer(100);
    expect(useGadget(slots, 0, p, EYE, AIM, null)).toEqual({ used: false });
    expect(p.hp).toBe(100);
    expect(slots[0]?.uses).toBe(2);
  });
});

describe('useGadget: drone', () => {
  it('launches a drone and spends its only use', () => {
    const slots: GadgetSlot[] = [createGadgetSlot('drone'), createGadgetSlot('frag')];
    const r = useGadget(slots, 0, alivePlayer(), { x: 1, y: 1.5, z: 2 }, { x: 0, y: 0, z: 1 }, null);
    if (!r.used || r.kind !== 'drone') throw new Error('expected a drone');
    expect(r.drone.pos).toEqual({ x: 1, y: 5, z: 2 });
    expect(slots[0]?.uses).toBe(0);
  });

  it('is ignored while a drone is already flying', () => {
    const slots: GadgetSlot[] = [createGadgetSlot('drone'), createGadgetSlot('frag')];
    const flying = launchDrone(EYE, AIM);
    expect(useGadget(slots, 0, alivePlayer(), EYE, AIM, flying)).toEqual({ used: false });
    expect(slots[0]?.uses).toBe(1);
  });
});

describe('recon drone', () => {
  it('expires after 10 s', () => {
    const d = launchDrone(EYE, AIM);
    expect(d.t).toBe(DRONE_LIFE);
    for (let i = 0; i < 19; i += 1) {
      expect(stepDrone(d, 0.5, [])).not.toBeNull();
    }
    expect(stepDrone(d, 0.5, [])).toBeNull();
  });

  it('flies at 9 m/s along the horizontal aim', () => {
    const d = launchDrone({ x: 0, y: 1.5, z: 0 }, { x: 0, y: -0.6, z: 0.8 });
    expect(d.dir.y).toBe(0);
    stepDrone(d, 1, []);
    expect(d.pos.x).toBeCloseTo(0, 9);
    expect(d.pos.z).toBeCloseTo(9, 9);
    expect(d.pos.y).toBe(5);
  });

  it('spots living hostiles within 22 m and not beyond', () => {
    const d = launchDrone(EYE, AIM);
    const near = makeEnemy('rifle', 0, 15, 60);
    const far = makeEnemy('rifle', 0, 30, 60);
    const dead = makeEnemy('rifle', 0, 5, 60);
    dead.alive = false;
    stepDrone(d, 0.1, [near, far, dead]);
    expect(near.spot).toBe(0.3);
    expect(far.spot).toBe(0);
    expect(dead.spot).toBe(0);
  });
});
