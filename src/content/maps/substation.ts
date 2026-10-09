import { WALL_H } from '../tuning';
import type { MapBox, MapDef } from './types';

// Legacy substation layout: index.html:549-562 (MAPS.substation). The building, cover and roof helpers are
// copies of the ones in compound.ts. They are not exported from there, and compound.ts is not edited in phase 2.
type Side = 'N' | 'S' | 'E' | 'W';

interface BuildingDef {
  // [x0, z0, x1, z1]
  b: [number, number, number, number];
  door: Side;
  breach: Partial<Record<Side, boolean>>;
}

// index.html:554-558
const BUILDINGS: readonly BuildingDef[] = [
  { b: [-12, -30, 12, -10], door: 'S', breach: { N: true } },
  { b: [-44, 24, -30, 38], door: 'N', breach: {} },
  { b: [30, 24, 44, 38], door: 'N', breach: { W: true } },
  { b: [-8, 24, 8, 36], door: 'E', breach: { W: true } },
];

// index.html:560. [x0, z0, x1, z1] with an optional height. Legacy default cover height is 1.2 (index.html:1004).
type CoverEntry = readonly [number, number, number, number, number?];
const COVER: readonly CoverEntry[] = [
  [-30, -8, -22, 4, 2.4],
  [22, -8, 30, 4, 2.4],
  [-6, -50, 6, -46],
  [50, -30, 58, -22, 2.4],
  [-58, 30, -50, 40, 2.4],
  [-20, 46, -6, 50],
  [12, 46, 26, 50],
  [-34, -40, -26, -36],
  [34, -40, 40, -34],
  [-50, -14, -44, -8, 2.4],
  [-20, 0, -14, 6],
];
const COVER_H_DEFAULT = 1.2;

// index.html:777. Wall thickness and half the door gap.
const WALL_T = 0.25;
const DOOR_HALF = 1.6;
// index.html:794. Corner pillars are 0.7 m square and 0.3 m taller than the walls.
const PILLAR_HALF = 0.35;
const PILLAR_EXTRA = 0.3;
// index.html:1043-1046 is the outer boundary, 8 m tall.
const BOUNDARY_H = 8;
// index.html:789-790 roof trim: 0.6 m wider than the footprint, 0.12 m thick, sitting on the walls.
const TRIM_OVERHANG = 0.3;
const TRIM_T = 0.12;

function box(x0: number, z0: number, x1: number, z1: number, h: number, breakable = false): MapBox {
  return { min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: h, z: z1 }, breakable };
}

// Legacy wallSeg (index.html:766-772). A breachable segment is split into three breakable boxes.
function wallSegments(x0: number, z0: number, x1: number, z1: number, breakable: boolean): MapBox[] {
  if (!breakable) return [box(x0, z0, x1, z1, WALL_H)];
  const horiz = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const out: MapBox[] = [];
  for (let i = 0; i < 3; i++) {
    const a = i / 3;
    const b = (i + 1) / 3;
    if (horiz) out.push(box(x0 + (x1 - x0) * a, z0, x0 + (x1 - x0) * b, z1, WALL_H, true));
    else out.push(box(x0, z0 + (z1 - z0) * a, x1, z0 + (z1 - z0) * b, WALL_H, true));
  }
  return out;
}

// Legacy building() (index.html:775-795): four walls with a door gap, then corner pillars.
function buildingBoxes(bd: BuildingDef): MapBox[] {
  const [x0, z0, x1, z1] = bd.b;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const t = WALL_T;
  const g = DOOR_HALF;
  const sides: Record<Side, [number, number, number, number]> = {
    N: [x0, z0 - t, x1, z0 + t],
    S: [x0, z1 - t, x1, z1 + t],
    W: [x0 - t, z0, x0 + t, z1],
    E: [x1 - t, z0, x1 + t, z1],
  };
  const out: MapBox[] = [];
  for (const s of ['N', 'S', 'W', 'E'] as const) {
    const [a, b, c, d] = sides[s];
    const brk = bd.breach[s] === true;
    if (s !== bd.door) {
      out.push(...wallSegments(a, b, c, d, brk));
      continue;
    }
    if (s === 'N' || s === 'S') {
      out.push(...wallSegments(a, b, cx - g, d, brk), ...wallSegments(cx + g, b, c, d, brk));
    } else {
      out.push(...wallSegments(a, b, c, cz - g, brk), ...wallSegments(a, cz + g, c, d, brk));
    }
  }
  for (const [px, pz] of [
    [x0, z0],
    [x1, z0],
    [x0, z1],
    [x1, z1],
  ] as const) {
    out.push(
      box(px - PILLAR_HALF, pz - PILLAR_HALF, px + PILLAR_HALF, pz + PILLAR_HALF, WALL_H + PILLAR_EXTRA),
    );
  }
  return out;
}

function roofTrim(bd: BuildingDef): MapBox {
  const [x0, z0, x1, z1] = bd.b;
  return {
    min: { x: x0 - TRIM_OVERHANG, y: WALL_H, z: z0 - TRIM_OVERHANG },
    max: { x: x1 + TRIM_OVERHANG, y: WALL_H + TRIM_T, z: z1 + TRIM_OVERHANG },
    breakable: false,
  };
}

// index.html:1043-1046
const BOUNDARY: MapBox[] = [
  box(-60, -60.5, 60, -59.5, BOUNDARY_H),
  box(-60, 59.5, 60, 60.5, BOUNDARY_H),
  box(-60.5, -60, -59.5, 60, BOUNDARY_H),
  box(59.5, -60, 60.5, 60, BOUNDARY_H),
];

export const SUBSTATION: MapDef = {
  id: 'substation',
  name: 'Substation',
  zones: [
    { name: 'CONTROL', x: 0, z: -20 },
    { name: 'GENERATOR', x: 0, z: 30 },
    { name: 'TRANSFORMER', x: -37, z: 31 },
  ],
  sky: { horizon: 0x1d2a38, zenith: 0x070c14, stars: true },
  fog: [65, 170],
  ground: 0x55554c,
  sun: 0x9fb4d8,
  crates: 40,
  barrels: 12,
  sandbags: 6,
  boxes: [
    ...BOUNDARY,
    ...BUILDINGS.flatMap(buildingBoxes),
    ...COVER.map(([x0, z0, x1, z1, h]) => box(x0, z0, x1, z1, h ?? COVER_H_DEFAULT)),
  ],
  roofs: BUILDINGS.map(roofTrim),
};
