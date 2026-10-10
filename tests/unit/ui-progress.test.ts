import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PRIMARY_WEAPON_IDS } from '../../src/content/ids';
import { MEDAL_IDS, MAX_RANK, xpAtRank } from '../../src/content/progression';
import { claymoreModel } from '../../src/render/gadget-models';
import {
  EMP_PULSE_SECONDS,
  EMP_RING_RADIUS,
  SHIELD_FLASH_SECONDS,
  createStreakFx,
  empRingAt,
  shieldFlashAt,
} from '../../src/render/streak-fx';
import { makeHumanRig } from '../../src/render/humans';
import {
  CROSSHAIR_COLOURS,
  CROSSHAIR_STYLES,
  DEFAULT_SETTINGS,
  FPS_CAPS,
  sanitizeSettings,
  validateCrosshair,
  validateCrosshairColour,
  validateFpsCap,
} from '../../src/persist/schema';
import { createProfile } from '../../src/persist/profile';
import { statusesFor } from '../../src/app/hud-view';
import { PAD_ROWS, weaponStatBars } from '../../src/ui/screens/model';
import {
  careerTiles,
  challengeRows,
  formatDuration,
  lockText,
  masteryRows,
  medalRows,
  nextUnlocks,
  percent,
  rankView,
  unlockLabel,
} from '../../src/ui/screens/career-model';
import { DT, IDLE, openFieldSim, pressing } from './support/sim-fixtures';

describe('weapon stat bars', () => {
  it('has damage, rate, range and control for every primary, each within 0..100', () => {
    for (const id of PRIMARY_WEAPON_IDS) {
      const bars = weaponStatBars(id);
      expect(bars.map((b) => b.label)).toEqual(['Damage', 'Rate', 'Range', 'Control', 'Magazine']);
      for (const b of bars) {
        expect(b.pct).toBeGreaterThanOrEqual(0);
        expect(b.pct).toBeLessThanOrEqual(100);
      }
    }
  });

  it('ranks the weapons the way their roles say', () => {
    const bar = (id: (typeof PRIMARY_WEAPON_IDS)[number], label: string): number =>
      weaponStatBars(id).find((b) => b.label === label)?.pct ?? -1;
    expect(bar('lb', 'Damage')).toBeGreaterThan(bar('vx', 'Damage'));
    expect(bar('hp', 'Rate')).toBeGreaterThan(bar('vx', 'Rate'));
    expect(bar('lb', 'Range')).toBeGreaterThan(bar('bk', 'Range'));
    expect(bar('hp', 'Control')).toBeGreaterThan(bar('bk', 'Control'));
  });
});

describe('career model', () => {
  it('formats durations and percentages', () => {
    expect(formatDuration(59)).toBe('0 min');
    expect(formatDuration(3725)).toBe('1 h 2 min');
    expect(percent(1, 4)).toBe('25%');
    expect(percent(1, 0)).toBe('–');
  });

  it('shows the rank heading and the XP into the rank', () => {
    const v = rankView(xpAtRank(4) + 100);
    expect(v.rank).toBe(4);
    expect(v.heading.startsWith('Rank 4')).toBe(true);
    expect(v.xpText).toContain('100');
    expect(rankView(xpAtRank(MAX_RANK)).xpText).toBe('Max rank');
  });

  it('an empty profile reads as zeros with dashes for ratios', () => {
    const tiles = careerTiles(createProfile());
    expect(tiles.find((t) => t.sub === 'Matches played')?.title).toBe('0');
    expect(tiles.find((t) => t.sub === 'Accuracy')?.title).toBe('–');
    expect(tiles.find((t) => t.sub.startsWith('Win rate'))?.title).toBe('–');
  });

  it('lists mastery for every primary weapon', () => {
    const p = { ...createProfile(), killsBySource: { vx: 25 } };
    const rows = masteryRows(p);
    expect(rows).toHaveLength(PRIMARY_WEAPON_IDS.length);
    expect(rows.find((r) => r.id === 'vx')?.level).toBe(1);
    expect(rows.find((r) => r.id === 'vx')?.text).toBe('Level 1 · 25 kills');
    expect(rows.find((r) => r.id === 'kv')?.text).toBe('Level 0 · 0 kills');
  });

  it('shows stored challenge progress for today only', () => {
    const day = '2026-10-10';
    const stored = {
      ...createProfile(),
      challenges: { day, progress: [2, 0, 0], done: [false, false, true] },
    };
    const today = challengeRows(stored, day);
    expect(today).toHaveLength(3);
    expect(today[0]?.progress).toBe(2);
    expect(today[2]?.done).toBe(true);
    const tomorrow = challengeRows(stored, '2026-10-11');
    expect(tomorrow.every((r) => r.progress === 0 && !r.done)).toBe(true);
  });

  it('lists every medal with its count', () => {
    const rows = medalRows({ ...createProfile(), medals: { ace: 2 } });
    expect(rows.map((r) => r.id)).toEqual([...MEDAL_IDS]);
    expect(rows.find((r) => r.id === 'ace')?.count).toBe(2);
  });

  it('names unlocks and says when they open', () => {
    expect(unlockLabel({ kind: 'weapon', id: 'lb' })).toBe('Longbow Sniper');
    expect(unlockLabel({ kind: 'difficulty', id: 'nightmare' })).toBe('Nightmare difficulty');
    expect(lockText('weapon', 'lb')).toBe('Unlocks at rank 15');
    const next = nextUnlocks(1, 3);
    expect(next).toHaveLength(3);
    expect(next.every((u) => u.rank > 1)).toBe(true);
    expect(nextUnlocks(MAX_RANK)).toEqual([]);
  });

  it('the gamepad list covers fire, aim, pause and the movement sticks', () => {
    const texts = PAD_ROWS.map((r) => r.text);
    expect(texts).toEqual(expect.arrayContaining(['Move', 'Look', 'Fire', 'Aim down sights', 'Pause']));
  });
});

describe('new settings', () => {
  it('have defaults and validate one by one', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      crosshair: 'cross',
      crosshairColour: 'default',
      damageNumbers: true,
      reducedMotion: false,
      fpsCap: 0,
    });
    for (const v of CROSSHAIR_STYLES) expect(validateCrosshair(v)).toBe(v);
    for (const v of CROSSHAIR_COLOURS) expect(validateCrosshairColour(v)).toBe(v);
    for (const v of FPS_CAPS) expect(validateFpsCap(v)).toBe(v);
    expect(validateCrosshair('laser')).toBeUndefined();
    expect(validateCrosshairColour(3)).toBeUndefined();
    expect(validateFpsCap(144)).toBeUndefined();
  });

  it('a bad new value falls back alone', () => {
    const s = sanitizeSettings({ sens: 2, crosshair: 'laser', fpsCap: 60, damageNumbers: 'yes' });
    expect(s.sens).toBe(2);
    expect(s.crosshair).toBe('cross');
    expect(s.fpsCap).toBe(60);
    expect(s.damageNumbers).toBe(true);
  });
});

describe('HUD status chips', () => {
  it('show the Aegis shield and the stim shot while they run', () => {
    const sim = openFieldSim({ gadgets: ['stim', 'smoke'] });
    expect(statusesFor(sim)).toEqual([]);
    sim.step(pressing('gadget1'), DT);
    const stim = statusesFor(sim);
    expect(stim).toHaveLength(1);
    expect(stim[0]).toMatchObject({ id: 'stim', label: 'Stim shot' });
    expect(stim[0]?.frac).toBeGreaterThan(0.9);

    sim.shieldT = 6;
    const both = statusesFor(sim);
    expect(both.map((s) => s.id)).toEqual(['shield', 'stim']);
    expect(both[0]?.frac).toBeCloseTo(0.5, 5);

    // The effects run down with the sim.
    sim.shieldT = 0.01;
    sim.step(IDLE, DT);
    expect(statusesFor(sim).some((s) => s.id === 'shield')).toBe(false);
  });
});

describe('streak effects', () => {
  it('the shield bubble snaps out and fades to nothing', () => {
    expect(shieldFlashAt(0).opacity).toBeGreaterThan(0.4);
    expect(shieldFlashAt(SHIELD_FLASH_SECONDS).opacity).toBe(0);
    expect(shieldFlashAt(SHIELD_FLASH_SECONDS / 2).scale).toBeGreaterThan(shieldFlashAt(0).scale);
  });

  it('the EMP ring grows to the map edge while it fades', () => {
    expect(empRingAt(0).radius).toBeCloseTo(1, 5);
    expect(empRingAt(EMP_PULSE_SECONDS).radius).toBeCloseTo(EMP_RING_RADIUS, 5);
    expect(empRingAt(EMP_PULSE_SECONDS).opacity).toBe(0);
    expect(empRingAt(0.3).radius).toBeLessThan(empRingAt(0.6).radius);
  });

  it('spawns meshes into the scene, and removes them when they finish', () => {
    const scene = new THREE.Scene();
    const fx = createStreakFx(scene);
    fx.shieldFlash({ x: 1, y: 0, z: 2 });
    fx.empPulse({ x: 0, y: 0, z: 0 });
    expect(fx.live).toBe(4);
    expect(scene.children).toHaveLength(4);
    for (let i = 0; i < 100; i++) fx.update(0.05);
    expect(fx.live).toBe(0);
    expect(scene.children).toHaveLength(0);
    fx.dispose();
  });

  it('dispose clears effects that are still running', () => {
    const scene = new THREE.Scene();
    const fx = createStreakFx(scene);
    fx.empPulse({ x: 0, y: 0, z: 0 });
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

describe('claymore model', () => {
  it('is a faced group with a lamp that blinks while arming and holds red once armed', () => {
    const m = claymoreModel(3, 4, 1.2);
    expect(m.group.position.x).toBe(3);
    expect(m.group.position.z).toBe(4);
    expect(m.group.rotation.y).toBeCloseTo(1.2, 9);
    const lamp = m.group.children[m.group.children.length - 1] as THREE.Mesh;
    const mat = lamp.material as THREE.MeshBasicMaterial;
    m.update(0.5, 0.01);
    const arming = mat.color.getHex();
    m.update(0.5, 0.3);
    expect(mat.color.getHex()).not.toBe(arming);
    m.update(0, 1);
    expect(mat.color.getHex()).toBe(0xff2a2a);
    m.dispose();
  });
});

describe('medic and rusher bodies', () => {
  it('the medic carries more parts than the rifleman it is built on, and the rusher leans', () => {
    const count = (kind: Parameters<typeof makeHumanRig>[0]): number => {
      let n = 0;
      makeHumanRig(kind, 0x445566).group.traverse(() => {
        n += 1;
      });
      return n;
    };
    const rifle = makeHumanRig('rifle', 0x445566);
    const medic = makeHumanRig('medic', 0x445566);
    const rusher = makeHumanRig('rusher', 0x445566);
    expect(rifle.lean).toBe(0);
    expect(medic.lean).toBe(0);
    expect(rusher.lean).toBeGreaterThan(0);
    // A medic has white and red materials the rifleman lacks.
    const materials = (rig: ReturnType<typeof makeHumanRig>): Set<number> => {
      const set = new Set<number>();
      for (const b of rig.body) {
        const m = Array.isArray(b.material) ? b.material : [b.material];
        for (const x of m) if ('color' in x) set.add((x as THREE.MeshStandardMaterial).color.getHex());
      }
      return set;
    };
    expect(materials(medic).has(0xd62d2d)).toBe(true);
    expect(materials(rifle).has(0xd62d2d)).toBe(false);
    expect(count('medic')).toBeGreaterThan(0);
  });
});
