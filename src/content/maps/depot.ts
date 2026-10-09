import { WALL_H } from '../tuning';
import type { MapBox, MapDef } from './types';

// Freight depot. This map has no legacy source: it is new in phase 2. The building, cover and roof helpers follow
// the conventions of compound.ts and substation.ts, and are copies because they are not exported from there.
type Side = 'N' | 'S' | 'E' | 'W';

interface BuildingDef {
  // [x0, z0, x1, z1]
  b: [number, number, number, number];
  door: Side;
  breach: Partial<Record<Side, boolean>>;
}

// Two warehouse blocks on the north-west and south-west edges, and a control hut on the east side.
const BUILDINGS: readonly BuildingDef[] = [
  { b: [-30, -36, -14, -24], door: 'E', breach: { N: true, W: true } },
  { b: [-40, 6, -24, 20], door: 'E', breach: { S: true, W: true } },
  { b: [14, -12, 22, -6], door: 'W', breach: {} },
];

// Shipping containers are 6.1 m by 2.44 m and 2.6 m high. A two-high stack is one box 5.2 m tall, because the
// collision world is 2D and a floating box would block the footprint below it.
type CoverEntry = readonly [number, number, number, number, number];
const CONTAINER_H = 2.6;
const CONTAINERS: readonly CoverEntry[] = [
  // Apron, west and south of the centre (double stacks).
  [-16, -3, -9.9, -0.56, 2 * CONTAINER_H],
  [-3.05, 12, 3.05, 14.44, 2 * CONTAINER_H],
  // Apron, north-east and east (single).
  [4, -14, 10.1, -11.56, CONTAINER_H],
  [12, 4, 14.44, 10.1, CONTAINER_H],
  // Yard, north of the yard zone (single).
  [-4, -36, 2.1, -33.56, CONTAINER_H],
  [8, -36, 14.1, -33.56, CONTAINER_H],
  // Dock, south of the dock zone (single).
  [-19, 21, -12.9, 23.44, CONTAINER_H],
];

// Rail siding: freight wagons in one row along x 38 to 41.5, with 2 m gaps between them. Wagons are 3.2 m high.
const WAGON_H = 3.2;
const WAGONS: readonly [number, number, number, number][] = [
  [38, -18, 41.5, -9],
  [38, -7, 41.5, 2],
  [38, 4, 41.5, 13],
];

// Pallet stacks, 1.2 m high (legacy default cover height, index.html:1004).
const COVER_H_DEFAULT = 1.2;
const PALLETS: readonly [number, number, number, number][] = [
  [-24, -18, -21, -16.8],
  [-2, -22, 0, -20.8],
  [18, 22, 20.6, 23.2],
];

// Wall thickness and half the door gap, as compound.ts.
const WALL_T = 0.25;
const DOOR_HALF = 1.6;
// Corner pillars are 0.7 m square and 0.3 m taller than the walls.
const PILLAR_HALF = 0.35;
const PILLAR_EXTRA = 0.3;
// The outer boundary is 8 m tall.
const BOUNDARY_H = 8;
// Roof trim: 0.6 m wider than the footprint, 0.12 m thick, sitting on the walls.
const TRIM_OVERHANG = 0.3;
const TRIM_T = 0.12;

function box(x0: number, z0: number, x1: number, z1: number, h: number, breakable = false): MapBox {
  return { min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: h, z: z1 }, breakable };
}

// A breachable segment is split into three breakable boxes, as compound.ts.
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

// Four walls with a door gap, then corner pillars, as compound.ts.
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

// The outer boundary, as compound.ts.
const BOUNDARY: MapBox[] = [
  box(-60, -60.5, 60, -59.5, BOUNDARY_H),
  box(-60, 59.5, 60, 60.5, BOUNDARY_H),
  box(-60.5, -60, -59.5, 60, BOUNDARY_H),
  box(59.5, -60, 60.5, 60, BOUNDARY_H),
];

export const DEPOT: MapDef = {
  id: 'depot',
  name: 'Freight Depot',
  zones: [
    { name: 'DOCK', x: -16, z: 12 },
    { name: 'SIDING', x: 30, z: 2 },
    { name: 'YARD', x: 4, z: -30 },
  ],
  sky: { horizon: 0x6b5648, zenith: 0x1a2030, stars: false },
  fog: [60, 160],
  ground: 0x4a4a45,
  sun: 0xffb070,
  crates: 46,
  barrels: 13,
  sandbags: 7,
  boxes: [
    ...BOUNDARY,
    ...BUILDINGS.flatMap(buildingBoxes),
    ...CONTAINERS.map(([x0, z0, x1, z1, h]) => box(x0, z0, x1, z1, h)),
    ...WAGONS.map(([x0, z0, x1, z1]) => box(x0, z0, x1, z1, WAGON_H)),
    ...PALLETS.map(([x0, z0, x1, z1]) => box(x0, z0, x1, z1, COVER_H_DEFAULT)),
  ],
  roofs: BUILDINGS.map(roofTrim),
};
