import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/core/rng';
import { DIFF } from '../../src/content/difficulty';
import {
  enemyTypeForWave,
  waveCount,
  nextWaveTimer,
  edgeSpawn,
  waveTick,
  guardLayout,
  type WaveState,
} from '../../src/sim/waves';

describe('enemyTypeForWave', () => {
  it('gives a grenadier at wave 4 with roll 0.1', () => {
    expect(enemyTypeForWave(4, 0.1)).toBe('grenadier');
  });

  it('wave 3 with roll 0.1 is a sniper, not a grenadier (grenadiers need wave 4)', () => {
    expect(enemyTypeForWave(3, 0.1)).toBe('sniper');
  });

  it('gives a sniper at wave 2 with roll 0.2 and a rifle at wave 1 with the same roll', () => {
    expect(enemyTypeForWave(2, 0.2)).toBe('sniper');
    expect(enemyTypeForWave(1, 0.2)).toBe('rifle');
  });

  it('gives a heavy at wave 3 with roll 0.4 and a rifle at wave 2 with the same roll', () => {
    expect(enemyTypeForWave(3, 0.4)).toBe('heavy');
    expect(enemyTypeForWave(2, 0.4)).toBe('rifle');
  });

  it('gives a rifle when the roll clears every threshold', () => {
    expect(enemyTypeForWave(6, 0.5)).toBe('rifle');
  });
});

describe('waveCount', () => {
  it('follows min(2 + floor(w/2), 6)', () => {
    expect(waveCount(1)).toBe(2);
    expect(waveCount(2)).toBe(3);
    expect(waveCount(7)).toBe(5);
  });

  it('caps at 6 (wave 10 gives 6)', () => {
    expect(waveCount(10)).toBe(6);
    expect(waveCount(40)).toBe(6);
  });
});

describe('nextWaveTimer', () => {
  it('subtracts 0.7 s per wave from the base timer', () => {
    expect(nextWaveTimer(14, 1)).toBeCloseTo(13.3, 10);
  });

  it('floors at 6 seconds', () => {
    expect(nextWaveTimer(11, 10)).toBe(6);
    expect(nextWaveTimer(6, 1)).toBe(6);
  });
});

describe('edgeSpawn', () => {
  it('stays on the 50-55 m ring when every point is open', () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const p = edgeSpawn(rng, () => true);
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeGreaterThanOrEqual(50);
      expect(r).toBeLessThanOrEqual(55 + 1e-9);
    }
  });

  it('falls back to (0, 52) when no point is open', () => {
    expect(edgeSpawn(createRng(1), () => false)).toEqual({ x: 0, z: 52 });
  });
});

describe('waveTick', () => {
  const diff = DIFF.veteran;

  it('advances the wave and reports a spawn count when the timer runs out', () => {
    const state: WaveState = { wave: 0, waveT: 1 };
    const out = waveTick(state, 2, 0, diff, true, 150);
    expect(state.wave).toBe(1);
    expect(state.waveT).toBeCloseTo(13.3, 10);
    expect(out.spawnCount).toBe(2);
  });

  it('does not advance while the timer is still running', () => {
    const state: WaveState = { wave: 0, waveT: 5 };
    const out = waveTick(state, 1, 0, diff, true, 150);
    expect(state).toEqual({ wave: 0, waveT: 4 });
    expect(out.spawnCount).toBe(0);
  });

  it('does not spawn or advance when every zone is captured', () => {
    const state: WaveState = { wave: 2, waveT: 0.1 };
    const out = waveTick(state, 5, 0, diff, false, 150);
    expect(out.spawnCount).toBe(0);
    expect(state).toEqual({ wave: 2, waveT: 0.1 });
  });

  it('does not spawn or advance when no enemy tickets remain', () => {
    const state: WaveState = { wave: 2, waveT: 0.1 };
    const out = waveTick(state, 5, 0, diff, true, 0);
    expect(out.spawnCount).toBe(0);
    expect(state).toEqual({ wave: 2, waveT: 0.1 });
  });

  it('limits the spawn count to the room left under maxHost', () => {
    const state: WaveState = { wave: 9, waveT: 0 };
    const out = waveTick(state, 0.1, DIFF.recruit.maxHost - 1, DIFF.recruit, true, 100);
    expect(out.spawnCount).toBe(1);
  });

  it('spawns nothing when the host is already full', () => {
    const state: WaveState = { wave: 9, waveT: 0 };
    const out = waveTick(state, 0.1, diff.maxHost + 3, diff, true, 100);
    expect(out.spawnCount).toBe(0);
  });
});

describe('guardLayout', () => {
  it('returns four guards per zone with the legacy kinds in order', () => {
    const zones = [
      { x: 0, z: 0 },
      { x: 30, z: -28 },
    ];
    const guards = guardLayout(zones, createRng(7));
    expect(guards).toHaveLength(8);
    for (let zi = 0; zi < zones.length; zi++) {
      const mine = guards.filter((g) => g.zone === zi);
      expect(mine.map((g) => g.kind)).toEqual(['rifle', 'sniper', 'heavy', 'grenadier']);
      const centre = zones[zi];
      if (centre === undefined) throw new Error('zone missing');
      for (const g of mine) {
        const r = Math.hypot(g.x - centre.x, g.z - centre.z);
        expect(r).toBeGreaterThanOrEqual(1.5);
        expect(r).toBeLessThan(4);
      }
    }
  });
});
