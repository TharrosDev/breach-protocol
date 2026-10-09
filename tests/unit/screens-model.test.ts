import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../../src/content/bindingDefaults';
import { DIFF } from '../../src/content/difficulty';
import { getMap } from '../../src/content/maps';
import { YAW_PER_PX, ZONE_TICKET_COST } from '../../src/content/tuning';
import { DEFAULT_LOADOUT } from '../../src/persist/schema';
import {
  applyRebind,
  calcCmAds,
  calcCmPer360,
  calcText,
  controlRows,
  debriefHeading,
  keyLabel,
  loadoutGadgetToggle,
  loadoutTiles,
  primaryBars,
  scoreLineSample,
  tileValues,
  winConditionText,
} from '../../src/ui/screens/model';

describe('loadoutGadgetToggle', () => {
  it('adds a gadget when there is room', () => {
    expect(loadoutGadgetToggle(['frag'], 'smoke')).toEqual(['frag', 'smoke']);
    expect(loadoutGadgetToggle([], 'drone')).toEqual(['drone']);
  });

  it('removes a gadget that is already selected', () => {
    expect(loadoutGadgetToggle(['frag', 'smoke'], 'frag')).toEqual(['smoke']);
  });

  it('shifts the oldest selection out when a third gadget is picked', () => {
    expect(loadoutGadgetToggle(['frag', 'smoke'], 'flash')).toEqual(['smoke', 'flash']);
  });

  it('never keeps more than two gadgets, even from a longer list', () => {
    expect(loadoutGadgetToggle(['frag', 'smoke', 'medkit'], 'drone')).toEqual(['medkit', 'drone']);
  });

  it('does not change the list it was given', () => {
    const current = ['frag', 'smoke'] as const;
    loadoutGadgetToggle(current, 'flash');
    expect(current).toEqual(['frag', 'smoke']);
  });
});

describe('calcCmPer360 and calcCmAds', () => {
  it('uses the legacy formula: 2 pi over (yaw per px times sensitivity), per DPI, times 2.54', () => {
    const { inches, cm } = calcCmPer360(1, 800, YAW_PER_PX);
    const expectedInches = (Math.PI * 2) / (YAW_PER_PX * 1) / 800;
    expect(inches).toBeCloseTo(expectedInches, 9);
    expect(cm).toBeCloseTo(expectedInches * 2.54, 9);
  });

  it('halves the travel when sensitivity doubles', () => {
    const slow = calcCmPer360(1, 800, YAW_PER_PX).cm;
    const fast = calcCmPer360(2, 800, YAW_PER_PX).cm;
    expect(fast).toBeCloseTo(slow / 2, 9);
  });

  it('divides by the ADS multiplier, with the legacy 0.05 floor', () => {
    expect(calcCmAds(10, 0.5)).toBeCloseTo(20, 9);
    expect(calcCmAds(10, 0)).toBeCloseTo(200, 9);
  });

  it('builds the two calculator lines the legacy text shows', () => {
    const text = calcText(1, 800, 0.7, YAW_PER_PX);
    expect(text.hip).toBe('3.6 in / 9.1 cm of mouse travel at 800 DPI.');
    expect(text.ads).toBe('13.0 cm for the same turn.');
  });
});

describe('winConditionText', () => {
  it('reads like the legacy brief for the given counts', () => {
    expect(winConditionText(3, 150, 3, 35)).toBe(
      "Capture all 3 objectives, or drive the enemy's 150 tickets to zero. You have 3 reinforcements. " +
        'Each hostile killed costs them one ticket; each captured zone costs them 35.',
    );
  });

  it('uses the real map, difficulty and zone cost', () => {
    const map = getMap('compound');
    const df = DIFF.veteran;
    const text = winConditionText(map.zones.length, df.tickets, df.lives, ZONE_TICKET_COST);
    expect(text).toContain(`Capture all ${String(map.zones.length)} objectives`);
    expect(text).toContain(`${String(df.tickets)} tickets`);
    expect(text).toContain(`${String(df.lives)} reinforcements`);
    expect(text.endsWith(`costs them ${String(ZONE_TICKET_COST)}.`)).toBe(true);
  });
});

describe('scoreLineSample', () => {
  it('formats the debrief sentence the same way as the sim (floors the time)', () => {
    expect(
      scoreLineSample({
        score: 1250,
        kills: 7,
        deaths: 2,
        zonesCaptured: 2,
        zonesTotal: 3,
        seconds: 245.9,
        mapName: 'Compound',
        difficulty: 'Veteran',
      }),
    ).toBe('Score 1250 · 7 eliminations · 2 deaths · 2/3 objectives · 245s · Compound, Veteran');
  });
});

describe('tileValues', () => {
  it('lists the six performance tiles in the legacy order', () => {
    const tiles = tileValues({
      kills: 4,
      deaths: 1,
      score: 900,
      shots: 20,
      hits: 5,
      seconds: 61.5,
      streak: 3,
    });
    expect(tiles.map((t) => t.label)).toEqual([
      'Eliminations',
      'Deaths',
      'Score',
      'Accuracy',
      'Time in match',
      'Current streak',
    ]);
    expect(tiles.map((t) => t.value)).toEqual(['4', '1', (900).toLocaleString(), '25%', '61s', '3']);
  });

  it('shows a dash for accuracy when no shot was fired', () => {
    const accuracy = tileValues({
      kills: 0,
      deaths: 0,
      score: 0,
      shots: 0,
      hits: 0,
      seconds: 0,
      streak: 0,
    })[3];
    expect(accuracy?.value).toBe('–');
  });

  it('rounds accuracy to a whole percent', () => {
    const accuracy = tileValues({
      kills: 0,
      deaths: 0,
      score: 0,
      shots: 3,
      hits: 1,
      seconds: 0,
      streak: 0,
    })[3];
    expect(accuracy?.value).toBe('33%');
  });
});

describe('debriefHeading', () => {
  it('uses the legacy headings', () => {
    expect(debriefHeading(true)).toBe('Sector Secured');
    expect(debriefHeading(false)).toBe('Mission Failed');
  });
});

describe('loadoutTiles', () => {
  it('shows weapon and attachment, perk, gadgets, and map with difficulty', () => {
    expect(loadoutTiles(DEFAULT_LOADOUT)).toEqual([
      { title: 'VX-9 Rifle', sub: 'Reflex optic attachment' },
      { title: 'Lightweight', sub: 'Perk' },
      { title: 'Frag + Smoke', sub: 'Gadgets' },
      { title: 'Compound', sub: 'Veteran difficulty' },
    ]);
  });
});

describe('primaryBars', () => {
  it('scales each stat by the legacy divisor', () => {
    const bars = primaryBars('vx');
    expect(bars.map((b) => b.label)).toEqual(['Damage', 'Rate', 'Magazine', 'Range']);
    expect(bars[0]?.pct).toBeCloseTo(40, 9);
    expect(bars[1]?.pct).toBeCloseTo(690 / 9, 9);
    expect(bars[2]?.pct).toBeCloseTo(30 / 0.9, 9);
    expect(bars[3]?.pct).toBeCloseTo(80, 9);
  });

  it('caps each bar at 100 percent', () => {
    const kv = primaryBars('kv');
    expect(kv[1]?.pct).toBe(100);
  });
});

describe('keyLabel', () => {
  it('uses the legacy key names and strips Key and Digit prefixes', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('ControlLeft')).toBe('Ctrl');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Escape')).toBe('Escape');
  });
});

describe('controlRows', () => {
  it('lists the controls with the default keys', () => {
    const rows = controlRows(DEFAULT_BINDINGS, keyLabel);
    expect(rows).toHaveLength(14);
    expect(rows.map((r) => r.keys)).toEqual([
      ['WASD'],
      ['Shift'],
      ['Ctrl'],
      ['Space'],
      ['LMB'],
      ['RMB'],
      ['R'],
      ['1', '2'],
      ['G', 'F'],
      ['E'],
      ['Q'],
      ['V'],
      ['H'],
      ['Tab'],
    ]);
    expect(rows[0]?.text).toBe('Move');
    expect(rows[2]?.text).toBe('Crouch (hold). Tap while sprinting to slide.');
  });

  it('follows the live bindings', () => {
    const rebound = applyRebind(DEFAULT_BINDINGS, 'forward', 'KeyI');
    const rows = controlRows(rebound, keyLabel);
    expect(rows[0]?.keys).toEqual(['IASD']);
  });
});

describe('applyRebind', () => {
  it('takes a free key for the action', () => {
    const next = applyRebind(DEFAULT_BINDINGS, 'reload', 'KeyT');
    expect(next.reload).toBe('KeyT');
    expect(next.jump).toBe(DEFAULT_BINDINGS.jump);
  });

  it('swaps with the action that held the key', () => {
    const next = applyRebind(DEFAULT_BINDINGS, 'forward', 'KeyS');
    expect(next.forward).toBe('KeyS');
    expect(next.back).toBe('KeyW');
  });

  it('keeps the bindings when the key is already the action key', () => {
    expect(applyRebind(DEFAULT_BINDINGS, 'forward', 'KeyW')).toEqual(DEFAULT_BINDINGS);
  });
});
