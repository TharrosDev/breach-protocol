import { describe, it, expect } from 'vitest';
import {
  createZone,
  updateZones,
  ZONE_CAPTURE_SCORE,
  ZONE_RADIUS,
  type Zone,
  type ZoneUpdateInput,
} from '../../src/sim/objectives';

interface Presence {
  player?: boolean;
  operator?: boolean;
  enemy?: boolean;
  playerAtCapture?: boolean;
}

// One zone with fixed presence flags. The inside tests ignore the zone geometry: the caller owns them.
function input(zone: Zone, p: Presence): ZoneUpdateInput {
  return {
    zones: [zone],
    playerInside: () => p.player === true,
    operatorInside: () => p.operator === true,
    enemyInside: () => p.enemy === true,
    playerInsideAtCapture: () => p.playerAtCapture === true,
  };
}

// Runs `steps` ticks of dt with fixed presence. Returns every capture reported.
function run(zone: Zone, p: Presence, steps: number, dt = 0.01): { zone: Zone; playerBonus: boolean }[] {
  const captures: { zone: Zone; playerBonus: boolean }[] = [];
  for (let i = 0; i < steps; i++) captures.push(...updateZones(input(zone, p), dt).captures);
  return captures;
}

describe('createZone', () => {
  it('starts idle, uncaptured, with radius 4.2 and no progress', () => {
    const z = createZone({ name: 'ALPHA', x: -29, z: -28 });
    expect(z).toEqual({ name: 'ALPHA', x: -29, z: -28, r: 4.2, prog: 0, captured: false, status: 'idle' });
    expect(ZONE_RADIUS).toBe(4.2);
  });
});

describe('updateZones capture progress', () => {
  it('a friendly alone captures in 7 s: 700 steps of 0.01 s, within one step', () => {
    const z = createZone({ name: 'ALPHA', x: 0, z: 0 });
    let steps = 0;
    while (!z.captured && steps < 2000) {
      updateZones(input(z, { player: true }), 0.01);
      steps += 1;
    }
    expect(steps).toBeGreaterThanOrEqual(700);
    expect(steps).toBeLessThanOrEqual(701);
    expect(z.status).toBe('captured');
    expect(z.prog).toBe(1);
  });

  it('is not captured just before 7 s', () => {
    const z = createZone({ name: 'ALPHA', x: 0, z: 0 });
    run(z, { player: true }, 699);
    expect(z.captured).toBe(false);
    expect(z.status).toBe('capturing');
    expect(z.prog).toBeCloseTo(699 / 700, 9);
  });

  it('an operator alone counts as friendly and captures the zone', () => {
    const z = createZone({ name: 'ALPHA', x: 0, z: 0 });
    run(z, { operator: true }, 100);
    expect(z.status).toBe('capturing');
    expect(z.prog).toBeCloseTo(1 / 7, 9);
  });

  it('an enemy alone decays progress at 1/(7 * 0.6) per second', () => {
    const z = createZone({ name: 'ALPHA', x: 0, z: 0 });
    run(z, { player: true }, 350); // 3.5 s: progress 0.5
    expect(z.prog).toBeCloseTo(0.5, 9);
    run(z, { enemy: true }, 100); // 1 s of decay
    expect(z.prog).toBeCloseTo(0.5 - 1 / (7 * 0.6), 9);
    expect(z.status).toBe('contested');
    expect(z.captured).toBe(false);
  });

  it('clamps decaying progress at 0', () => {
    const z = createZone({ name: 'ALPHA', x: 0, z: 0 });
    run(z, { enemy: true }, 500);
    expect(z.prog).toBe(0);
    expect(z.status).toBe('contested');
  });

  it('both friendly and enemy inside is contested with no progress change', () => {
    const z = createZone({ name: 'ALPHA', x: 0, z: 0 });
    run(z, { player: true }, 350);
    const before = z.prog;
    run(z, { player: true, enemy: true }, 200);
    expect(z.prog).toBe(before);
    expect(z.status).toBe('contested');
  });

  it('nobody inside is idle with no progress change', () => {
    const z = createZone({ name: 'ALPHA', x: 0, z: 0 });
    run(z, { player: true }, 350);
    const before = z.prog;
    run(z, {}, 50);
    expect(z.prog).toBe(before);
    expect(z.status).toBe('idle');
  });

  it('a captured zone is no longer updated and reports no further captures', () => {
    const z = createZone({ name: 'ALPHA', x: 0, z: 0 });
    run(z, { player: true }, 700);
    expect(z.captured).toBe(true);
    const later = run(z, { enemy: true }, 200);
    expect(later).toEqual([]);
    expect(z.prog).toBe(1);
    expect(z.status).toBe('captured');
  });
});

describe('updateZones capture events', () => {
  it('reports playerBonus when the player is inside at capture', () => {
    const z = createZone({ name: 'BRAVO', x: 29, z: -28 });
    const captures = run(z, { player: true, playerAtCapture: true }, 700);
    expect(captures).toHaveLength(1);
    expect(captures[0]?.zone).toBe(z);
    expect(captures[0]?.playerBonus).toBe(true);
    expect(ZONE_CAPTURE_SCORE).toBe(250);
  });

  it('reports no playerBonus when only an operator captures', () => {
    const z = createZone({ name: 'BRAVO', x: 29, z: -28 });
    const captures = run(z, { operator: true, playerAtCapture: false }, 700);
    expect(captures).toHaveLength(1);
    expect(captures[0]?.playerBonus).toBe(false);
  });
});
