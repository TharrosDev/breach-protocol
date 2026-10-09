import { WALL_H } from '../tuning';
import type { MapBox, MapDef } from './types';

// Legacy compound layout: index.html:533-547 (MAPS.compound), building helper at index.html:775-795.
type Side = 'N' | 'S' | 'E' | 'W';

interface BuildingDef {
  // [x0, z0, x1, z1]
  b: [number, number, number, number];
  door: Side;
  breach: Partial<Record<Side, boolean>>;
}

// index.html:539-545
const BUILDINGS: readonly BuildingDef[] = [
  { b: [-40, -36, -18, -20], door: 'S', breach: { E: true } },
  { b: [18, -36, 40, -20], door: 'S', breach: { W: true } },
  { b: [-14, 14, 16, 30], door: 'N', breach: { E: true, W: true } },
  { b: [-48, 20, -36, 32], door: 'E', breach: {} },
  { b: [36, 12, 50, 24], door: 'W', breach: { N: true } },
];

// index.html:546. [x0, z0, x1, z1]. Legacy default cover height is 1.2 (index.html:1004).
const COVER: readonly [number, number, number, number][] = [
  [-10, -44, 4, -43.2],
  [50, -44, 58, -43.2],
  [-52, 50, -44, 51.2],
  [-8, 40, 8, 41.2],
  [8, -6, 10, 6],
  [-30, 4, -24, 5.5],
  [38, -8, 44, -2],
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

export const COMPOUND: MapDef = {
  id: 'compound',
  name: 'Compound',
  zones: [
    { name: 'ALPHA', x: -29, z: -28 },
    { name: 'BRAVO', x: 29, z: -28 },
    { name: 'CHARLIE', x: 1, z: 22 },
  ],
  sky: { horizon: 0x2a3440, zenith: 0x0d1219, stars: false },
  fog: [55, 150],
  ground: 0x46533f,
  sun: 0xffe0b0,
  crates: 55,
  barrels: 14,
  sandbags: 8,
  boxes: [
    ...BOUNDARY,
    ...BUILDINGS.flatMap(buildingBoxes),
    ...COVER.map(([x0, z0, x1, z1]) => box(x0, z0, x1, z1, COVER_H_DEFAULT)),
  ],
  roofs: BUILDINGS.map(roofTrim),
};
