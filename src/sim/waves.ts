import type { Vec2 } from '../core/math';
import type { Rng } from '../core/rng';
import type { EnemyKindId } from '../content/enemies';
import type { DifficultyDef } from '../content/difficulty';

// Wave rules ported from the legacy game (index.html:2358-2388, 2629-2635).

export interface WaveState {
  wave: number;
  waveT: number;
}

export interface GuardSpawn {
  zone: number;
  kind: EnemyKindId;
  x: number;
  z: number;
}

const TAU = Math.PI * 2;
// Legacy resetMatch defender order (index.html:2630).
const GUARD_KINDS: readonly EnemyKindId[] = ['rifle', 'sniper', 'heavy', 'grenadier'];

// index.html:2358-2364, extended with the rusher (wave 2+, rolls 0.72-0.9) and the medic (wave 3+, rolls from 0.9).
// `roll` is a uniform draw in [0, 1) supplied by the caller. The legacy bands below 0.5 are unchanged.
export function enemyTypeForWave(wave: number, roll: number): EnemyKindId {
  if (wave >= 4 && roll < 0.18) return 'grenadier';
  if (wave >= 2 && roll < 0.3) return 'sniper';
  if (wave >= 3 && roll < 0.5) return 'heavy';
  if (wave >= 3 && roll >= 0.9) return 'medic';
  if (wave >= 2 && roll >= 0.72 && roll < 0.9) return 'rusher';
  return 'rifle';
}

// First juggernaut arrives on wave 6, then every third wave (9, 12, ...). One at a time.
export const JUGGERNAUT_FIRST_WAVE = 6;
export const JUGGERNAUT_EVERY = 3;
export function isJuggernautWave(wave: number): boolean {
  return wave >= JUGGERNAUT_FIRST_WAVE && (wave - JUGGERNAUT_FIRST_WAVE) % JUGGERNAUT_EVERY === 0;
}

// index.html:2379 (count after the wave counter is incremented).
export function waveCount(wave: number): number {
  return Math.min(2 + Math.floor(wave / 2), 6);
}

// index.html:2382 (timer after the wave counter is incremented).
export function nextWaveTimer(base: number, wave: number): number {
  return Math.max(6, base - wave * 0.7);
}

// index.html:2359-2370. Ring spawn at radius 50-55 m; a point is accepted when isOpen(x, z, 1.2) holds.
export function edgeSpawn(rng: Rng, isOpen: (x: number, z: number, r: number) => boolean): Vec2 {
  for (let i = 0; i < 40; i++) {
    const a = rng.next() * TAU;
    const r = 50 + rng.next() * 5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (isOpen(x, z, 1.2)) return { x, z };
  }
  return { x: 0, z: 52 };
}

// index.html:2373-2388. Mutates state (wave, waveT) and reports how many hostiles to spawn this tick.
// Does nothing while every zone is captured or no enemy tickets remain.
export function waveTick(
  state: WaveState,
  dt: number,
  aliveCount: number,
  diff: DifficultyDef,
  zonesOpen: boolean,
  ticketsLeft: number,
): { spawnCount: number } {
  if (!zonesOpen || ticketsLeft <= 0) return { spawnCount: 0 };
  state.waveT -= dt;
  if (state.waveT > 0) return { spawnCount: 0 };
  state.wave += 1;
  state.waveT = nextWaveTimer(diff.waveT, state.wave);
  const room = diff.maxHost - aliveCount;
  return { spawnCount: Math.max(0, Math.min(waveCount(state.wave), room)) };
}

// index.html:2629-2635. Four guards per zone, each at radius 1.5-4 m from the zone centre.
export function guardLayout(zoneCentres: readonly Vec2[], rng: Rng): GuardSpawn[] {
  const out: GuardSpawn[] = [];
  zoneCentres.forEach((c, zone) => {
    for (const kind of GUARD_KINDS) {
      const a = rng.next() * TAU;
      const r = 1.5 + rng.next() * 2.5;
      out.push({ zone, kind, x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r });
    }
  });
  return out;
}
