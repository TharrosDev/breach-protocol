import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/core/rng';
import { DIFF } from '../../src/content/difficulty';
import { ENEMY_DEFS } from '../../src/content/enemies';
import {
  ATTACHMENT_IDS,
  DIFFICULTY_IDS,
  GADGET_IDS,
  PERK_IDS,
  PRIMARY_WEAPON_IDS,
} from '../../src/content/ids';
import { KILLSTREAKS, KILLSTREAK_IDS } from '../../src/content/killstreaks';
import { WEAPONS } from '../../src/content/weapons';
import { validateGadgets, validatePrimary } from '../../src/persist/schema';
import { CollisionWorld } from '../../src/sim/collision';
import { damageEnemy, nearestEnemyHit } from '../../src/sim/combat';
import type { AiWorld, Enemy } from '../../src/sim/entities';
import { stepHostile } from '../../src/sim/ai/hostile';
import { MINE_ARM_TIME, MINE_TRIGGER_RADIUS, placeMine, stepMines, type Mine } from '../../src/sim/mines';
import type { NavGrid } from '../../src/sim/nav/types';
import { enemyTypeForWave, isJuggernautWave } from '../../src/sim/waves';
import { makeWeaponState, tickWeapon, tryFire } from '../../src/sim/weapons';
import type { FireContext } from '../../src/sim/weapons';
import { DT, makeEnemy, openFieldSim, pressing } from './support/sim-fixtures';

const CTX: FireContext = { ads: false, moving: false, sprinting: false, perk: 'steady' };

describe('new content ids', () => {
  it('lists the new weapons, attachments, perks, gadgets and the fourth difficulty', () => {
    expect(PRIMARY_WEAPON_IDS).toEqual(expect.arrayContaining(['rc', 'lb', 'hp']));
    expect(ATTACHMENT_IDS).toEqual(expect.arrayContaining(['compensator', 'hollow']));
    expect(PERK_IDS).toEqual(expect.arrayContaining(['scavenger', 'adrenaline']));
    expect(GADGET_IDS).toEqual(expect.arrayContaining(['claymore', 'stim']));
    expect(DIFFICULTY_IDS).toContain('nightmare');
    expect(DIFF.nightmare.ai).toBeGreaterThan(DIFF.elite.ai);
    for (const id of KILLSTREAK_IDS) expect(KILLSTREAKS[id].id).toBe(id);
  });

  it('accepts the new ids in saved data', () => {
    expect(validatePrimary('lb')).toBe('lb');
    expect(validateGadgets(['claymore', 'stim'])).toEqual(['claymore', 'stim']);
  });
});

describe('burst fire', () => {
  it('fires three shots per pull and then waits out the burst gap', () => {
    const w = makeWeaponState(WEAPONS.rc, 'none');
    expect(tryFire(w, CTX)).not.toBeNull();
    expect(w.burstLeft).toBe(2);
    tickWeapon(w, 60 / WEAPONS.rc.rpm + 0.001, false, 'steady');
    expect(tryFire(w, CTX)).not.toBeNull();
    tickWeapon(w, 60 / WEAPONS.rc.rpm + 0.001, false, 'steady');
    expect(tryFire(w, CTX)).not.toBeNull();
    expect(w.burstLeft).toBe(0);
    // The gap holds the next burst back past the normal interval.
    tickWeapon(w, 60 / WEAPONS.rc.rpm + 0.001, false, 'steady');
    expect(tryFire(w, CTX)).toBeNull();
  });

  it('keeps firing the burst in the world from one click', () => {
    const sim = openFieldSim({ weapon: WEAPONS.rc });
    sim.step({ ...pressing(), buttons: { fire: false, ads: false } }, DT, true);
    for (let i = 0; i < 40; i++) sim.step(pressing(), DT);
    expect(sim.playerShots).toBe(3);
  });
});

describe('attachments and perks', () => {
  it('compensator cuts recoil and spread bloom, hollow points add damage for less reserve', () => {
    const comp = makeWeaponState(WEAPONS.vx, 'compensator');
    expect(comp.recoilMul).toBeLessThan(1);
    expect(comp.gainMul).toBeLessThan(1);
    const hollow = makeWeaponState(WEAPONS.vx, 'hollow');
    expect(hollow.damageMul).toBeGreaterThan(1);
    expect(hollow.res).toBeLessThan(WEAPONS.vx.res);
    const plain = makeWeaponState(WEAPONS.vx, 'none');
    tryFire(plain, CTX);
    tryFire(comp, CTX);
    expect(comp.spread - WEAPONS.vx.spread).toBeLessThan(plain.spread - WEAPONS.vx.spread);
  });

  it('adrenaline heals on a kill and scavenger refills reserve ammo', () => {
    const adr = openFieldSim({ perk: 'adrenaline' });
    adr.player.hp = 50;
    const e = makeEnemy('rifle', 0, 5);
    e.hp = 1;
    adr.enemies = [e];
    // Kill via melee-free path: use the sim's own damage route through a grenade-free shot.
    const sim = adr as unknown as {
      hurtEnemy(e: Enemy, d: number, h: boolean, a: 'player', src: string, ev: unknown[]): void;
    };
    sim.hurtEnemy(e, 50, false, 'player', 'vx', []);
    expect(adr.player.hp).toBe(65);

    const scav = openFieldSim({ perk: 'scavenger' });
    scav.primary.res = 10;
    const e2 = makeEnemy('rifle', 0, 5);
    e2.hp = 1;
    scav.enemies = [e2];
    (
      scav as unknown as {
        hurtEnemy(e: Enemy, d: number, h: boolean, a: 'player', src: string, ev: unknown[]): void;
      }
    ).hurtEnemy(e2, 50, false, 'player', 'vx', []);
    expect(scav.primary.res).toBeGreaterThan(10);
  });

  it('the longbow one-shots a rifleman and is scoped', () => {
    expect(WEAPONS.lb.scoped).toBe(true);
    expect(WEAPONS.lb.dmg).toBeGreaterThanOrEqual(ENEMY_DEFS.rifle.hp);
  });
});

describe('new hostiles', () => {
  it('waves introduce rushers and medics at the right rolls, and the juggernaut every third wave from 6', () => {
    expect(enemyTypeForWave(1, 0.8)).toBe('rifle');
    expect(enemyTypeForWave(2, 0.8)).toBe('rusher');
    expect(enemyTypeForWave(2, 0.95)).toBe('rifle');
    expect(enemyTypeForWave(3, 0.95)).toBe('medic');
    expect([5, 6, 7, 9, 12].map(isJuggernautWave)).toEqual([false, true, false, true, true]);
  });

  it('a juggernaut leads wave 6 and only one lives at a time', () => {
    const sim = openFieldSim();
    sim.wave = { wave: 5, waveT: 0.001 };
    sim.step(pressing(), 0.01);
    expect(sim.enemies.filter((e) => e.kind === 'juggernaut')).toHaveLength(1);
    sim.wave = { wave: 8, waveT: 0.001 };
    sim.step(pressing(), 0.01);
    expect(sim.enemies.filter((e) => e.kind === 'juggernaut')).toHaveLength(1);
  });

  it('armour absorbs body damage but not headshots', () => {
    const j = makeEnemy('juggernaut', 0, 0);
    const before = j.hp;
    damageEnemy(j, 100, false, 'player');
    expect(before - j.hp).toBeCloseTo(45);
    const h = j.hp;
    damageEnemy(j, 100, true, 'player');
    expect(h - j.hp).toBeCloseTo(100);
  });

  it('the juggernaut has a bigger hit sphere', () => {
    const j = makeEnemy('juggernaut', 0, 6);
    const hit = nearestEnemyHit({ x: 0, y: 1.3, z: 0 }, { x: 0, y: 0, z: 1 }, 20, [j]);
    expect(hit).not.toBeNull();
    const r = makeEnemy('rifle', 0, 6);
    expect(nearestEnemyHit({ x: 0, y: 1.3, z: 0 }, { x: 0, y: 0, z: 1 }, 20, [r])).not.toBeNull();
    const high = nearestEnemyHit({ x: 0, y: 1.9, z: 0 }, { x: 0, y: 0, z: 1 }, 20, [j]);
    const highR = nearestEnemyHit({ x: 0, y: 1.9, z: 0 }, { x: 0, y: 0, z: 1 }, 20, [r]);
    expect(high).not.toBeNull();
    expect(highR).toBeNull();
  });
});

const openNav: NavGrid = {
  size: 120,
  rebuild() {},
  isWalk: () => true,
  lineWalk: () => true,
  findPath: () => [],
};

function aiWorld(enemies: Enemy[], ai?: number, playerZ = 20): AiWorld {
  return {
    time: 0,
    player: {
      pos: { x: 0, y: 0, z: playerZ },
      eyeHeight: 1.7,
      alive: true,
      moving: false,
      ghost: false,
      order: 0,
    },
    enemies,
    operators: [],
    nav: openNav,
    collision: new CollisionWorld(),
    smokes: [],
    zones: [],
    rng: createRng(3),
    pathBudget: { take: () => true },
    difficulty: ai === undefined ? { dmg: 1 } : { dmg: 1, ai },
  };
}

describe('hostile behaviours', () => {
  it('a medic heals wounded hostiles nearby but not itself', () => {
    const medic = makeEnemy('medic', 0, 0);
    const hurt = makeEnemy('rifle', 3, 0);
    hurt.hp = 10;
    medic.hp = 5;
    const far = makeEnemy('rifle', 30, 0);
    far.hp = 10;
    stepHostile(medic, aiWorld([medic, hurt, far], 0.7, 500), 1);
    expect(hurt.hp).toBeCloseTo(19);
    expect(medic.hp).toBe(5);
    expect(far.hp).toBe(10);
  });

  it('a rusher charges and only shoots from close in', () => {
    const r = makeEnemy('rusher', 0, 0);
    const events = stepHostile(r, aiWorld([r], 0.7, 25), 0.1);
    expect(events.some((e) => e.type === 'shoot')).toBe(false);
    expect(r.pos.z).toBeGreaterThan(0);
    const near = makeEnemy('rusher', 0, 0);
    near.engaged = true;
    const shots = stepHostile(near, aiWorld([near], 0.7, 8), 0.1);
    expect(shots.some((e) => e.type === 'shoot')).toBe(true);
  });

  it('sharper hostiles send squadmates to flank and suppress when they spot the player', () => {
    const mk = (): Enemy[] => [
      makeEnemy('rifle', 0, 0),
      makeEnemy('rifle', 4, 0),
      makeEnemy('rifle', -4, 0),
      makeEnemy('rifle', 2, -3),
    ];
    const elite = mk();
    stepHostile(elite[0] as Enemy, aiWorld(elite, 1, 30), 0.016);
    const roles = elite.slice(1).map((e) => e.role);
    expect(roles.filter((r) => r === 'flank')).toHaveLength(2);
    expect(roles.filter((r) => r === 'suppress')).toHaveLength(1);

    const legacy = mk();
    stepHostile(legacy[0] as Enemy, aiWorld(legacy, undefined, 30), 0.016);
    expect(legacy.every((e) => e.role === 'push')).toBe(true);
    const recruit = mk();
    stepHostile(recruit[0] as Enemy, aiWorld(recruit, DIFF.recruit.ai, 30), 0.016);
    expect(recruit.every((e) => e.role === 'push')).toBe(true);
  });

  it('a suppressor keeps firing at the last sighting after losing sight', () => {
    const e = makeEnemy('rifle', 0, 0);
    e.role = 'suppress';
    e.engaged = true;
    e.unseenT = 0.5;
    e.lastSeen = { x: 0, z: 15 };
    const events = stepHostile(e, aiWorld([e], 1, 500), 0.016);
    const shot = events.find((ev) => ev.type === 'shoot');
    expect(shot).toBeDefined();
    const none = makeEnemy('rifle', 0, 0);
    none.role = 'push';
    none.engaged = true;
    none.unseenT = 0.5;
    none.lastSeen = { x: 0, z: 15 };
    expect(stepHostile(none, aiWorld([none], 1, 500), 0.016).some((ev) => ev.type === 'shoot')).toBe(false);
  });
});

describe('claymore mines', () => {
  it('arms after a moment, then kills a hostile that walks close and hurts the player in range', () => {
    const mines: Mine[] = [placeMine({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })];
    expect(mines[0]?.pos.z).toBeCloseTo(1.2);
    const e = makeEnemy('rifle', 0, 1.2 + MINE_TRIGGER_RADIUS - 0.5);
    expect(stepMines(mines, MINE_ARM_TIME / 2, [e], { x: 50, y: 0, z: 50 }, true)).toHaveLength(0);
    const blasts = stepMines(mines, MINE_ARM_TIME, [e], { x: 0, y: 0, z: 0 }, true);
    expect(blasts).toHaveLength(1);
    expect(mines).toHaveLength(0);
    expect(blasts[0]?.enemyKills).toContain(e);
    expect(blasts[0]?.playerDamage).toBeGreaterThan(0);
  });

  it('works through the sim: the claymore gadget sets a mine that kills a passer-by', () => {
    const sim = openFieldSim({ gadgets: ['claymore', 'stim'] });
    const ev = sim.step(pressing('gadget1'), DT);
    expect(ev.some((x) => x.type === 'mineSet')).toBe(true);
    expect(sim.mines).toHaveLength(1);
    expect(sim.gadgets[0]?.uses).toBe(1);
    for (let i = 0; i < 90; i++) sim.step(pressing(), DT);
    const e = makeEnemy('rifle', 0, 3.2);
    e.hp = 10;
    sim.enemies = [e];
    const events = sim.step(pressing(), DT);
    expect(events.some((x) => x.type === 'grenadeBlast')).toBe(true);
    expect(e.alive).toBe(false);
  });
});

describe('stim, shield and EMP', () => {
  it('a stim shot regenerates health and speeds the player up', () => {
    const sim = openFieldSim({ gadgets: ['stim', 'claymore'] });
    sim.player.hp = 40;
    const ev = sim.step(pressing('gadget1'), DT);
    expect(ev.some((x) => x.type === 'stimUsed')).toBe(true);
    expect(sim.stimT).toBeGreaterThan(7);
    const before = sim.player.hp;
    for (let i = 0; i < 60; i++) sim.step(pressing(), DT);
    expect(sim.player.hp).toBeGreaterThan(before + 4);
  });

  it('the shield killstreak cuts incoming damage and the EMP blinds and scans hostiles', () => {
    const sim = openFieldSim();
    const e = makeEnemy('rifle', 0, 80);
    sim.enemies = [e];
    sim.killstreak = { ks: 'shield', ksUsed: 0 };
    sim.step(pressing('killstreak'), DT);
    expect(sim.shieldT).toBeGreaterThan(11);
    expect(sim.killstreak.ks).toBeNull();
    const priv = sim as unknown as {
      damagePlayerFrom(f: { x: number; z: number }, d: number, ev: unknown[]): void;
    };
    const hp = sim.player.hp;
    priv.damagePlayerFrom({ x: 0, z: 10 }, 20, []);
    expect(hp - sim.player.hp).toBeCloseTo(6);

    sim.killstreak = { ks: 'emp', ksUsed: 0 };
    sim.step(pressing('killstreak'), DT);
    expect(e.blind).toBeGreaterThan(6);
    expect(sim.uav.t).toBeGreaterThan(0);
  });
});
