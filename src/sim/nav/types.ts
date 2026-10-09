import type { Vec2 } from '../../core/math';

// Budget for A* searches per tick (legacy pathBudget, index.html:2909: 2 per frame).
export interface PathBudget {
  take(): boolean;
}

// Walkable 1 m grid built from the collision world (legacy index.html:887-1002).
export interface NavGrid {
  readonly size: number;
  rebuild(): void;
  isWalk(x: number, z: number): boolean;
  lineWalk(x0: number, z0: number, x1: number, z1: number): boolean;
  // Returns waypoints from start to target (excluding start), [] when already there, null when unreachable or budget is spent.
  findPath(sx: number, sz: number, tx: number, tz: number, budget: PathBudget): Vec2[] | null;
}
