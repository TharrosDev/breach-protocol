import { CAPTURE_TIME } from '../content/tuning';

// Zone capture rules ported from the legacy game (makeZone index.html:1012-1025, updZones index.html:2556-2581).
// The caller computes the inside tests; this module only moves zone state.

// index.html:1024 (zone radius, measured in XZ).
export const ZONE_RADIUS = 4.2;
// index.html:2565 (a contested zone decays at 0.6 times the capture rate).
export const CONTEST_DECAY = 0.6;
// index.html:2574 (score for a player inside when the zone is captured).
export const ZONE_CAPTURE_SCORE = 250;

export type ZoneStatus = 'idle' | 'capturing' | 'contested' | 'captured';

export interface Zone {
  name: string;
  x: number;
  z: number;
  r: number;
  // Capture progress, 0 (enemy side) to 1 (captured).
  prog: number;
  captured: boolean;
  status: ZoneStatus;
}

export function createZone(def: { name: string; x: number; z: number }): Zone {
  return { name: def.name, x: def.x, z: def.z, r: ZONE_RADIUS, prog: 0, captured: false, status: 'idle' };
}

export interface ZoneUpdateInput {
  zones: Zone[];
  // Alive player inside the zone radius (legacy pIn, which already requires P.alive).
  playerInside: (z: Zone) => boolean;
  // Any living operator inside the zone radius (legacy aIn).
  operatorInside: (z: Zone) => boolean;
  // Any living hostile inside the zone radius (legacy eIn).
  enemyInside: (z: Zone) => boolean;
  // Evaluated on the tick a zone is captured: true awards the player bonus (legacy pIn at index.html:2574).
  playerInsideAtCapture: (z: Zone) => boolean;
}

export interface ZoneCapture {
  zone: Zone;
  playerBonus: boolean;
}

// Advances every uncaptured zone by dt seconds (legacy updZones, index.html:2556-2581).
// Mutates the zones only. Ticket cost and score are applied by the caller from the returned captures.
export function updateZones(input: ZoneUpdateInput, dt: number): { captures: ZoneCapture[] } {
  const captures: ZoneCapture[] = [];
  for (const z of input.zones) {
    if (z.captured) continue;
    const friendly = input.playerInside(z) || input.operatorInside(z);
    const hostile = input.enemyInside(z);
    if (friendly && !hostile) {
      z.prog += dt / CAPTURE_TIME;
      z.status = 'capturing';
    } else if (hostile && !friendly) {
      z.prog -= dt / (CAPTURE_TIME * CONTEST_DECAY);
      z.status = 'contested';
    } else if (friendly && hostile) {
      z.status = 'contested';
    } else {
      z.status = 'idle';
    }
    z.prog = Math.min(1, Math.max(0, z.prog));
    if (z.prog >= 1) {
      z.captured = true;
      z.status = 'captured';
      captures.push({ zone: z, playerBonus: input.playerInsideAtCapture(z) });
    }
  }
  return { captures };
}
