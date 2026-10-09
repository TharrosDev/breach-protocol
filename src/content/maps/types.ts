import type { MapId } from '../ids';
import type { Vec3 } from '../../core/math';

// An axis-aligned box in world units. Ground-based boxes have min.y = 0.
export interface MapBox {
  min: Vec3;
  max: Vec3;
  breakable: boolean;
}

// Map definition as typed data. The numeric fields mirror legacy MAPS (index.html:533-563).
// Phase 1 uses zones, sky, fog, ground, sun and boxes. Props (crates, barrels, sandbags) are phase 2.
export interface MapDef {
  id: MapId;
  name: string;
  zones: { name: string; x: number; z: number }[];
  sky: { horizon: number; zenith: number; stars: boolean };
  fog: [number, number];
  ground: number;
  sun: number;
  crates: number;
  barrels: number;
  sandbags: number;
  // Colliders. Walls, cover and boundary walls are all here.
  boxes: MapBox[];
  // Visual-only roof trim (legacy index.html:789-790). Not colliders.
  roofs: MapBox[];
}
