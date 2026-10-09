import * as THREE from 'three';
import type { Rng } from '../core/rng';

const FALL_SPEED = 16;
const CEILING = 22;
const HALF_SPREAD = 25;
// Each streak is a segment from (x, y, z) to (x - 0.12, y + 0.55, z), as legacy (index.html:3160-3163).
const STREAK_DX = -0.12;
const STREAK_DY = 0.55;

// Pure rain state (legacy updRain, index.html:3143-3171). Streaks are kept relative to the player and
// written to positions in world space, so the segments follow the player without a parent transform.
export class RainField {
  // Two points per streak, x y z each: count * 6 floats.
  readonly positions: Float32Array;
  readonly count: number;
  // Per-streak position relative to the player origin: x y z, count * 3 floats.
  private readonly local: Float64Array;
  private readonly rng: Rng;
  private originX = 0;
  private originZ = 0;

  constructor(rng: Rng, count = 600) {
    this.rng = rng;
    this.count = count;
    this.positions = new Float32Array(count * 6);
    this.local = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.local[i * 3] = rng.range(-HALF_SPREAD, HALF_SPREAD);
      this.local[i * 3 + 1] = rng.range(0, CEILING);
      this.local[i * 3 + 2] = rng.range(-HALF_SPREAD, HALF_SPREAD);
    }
    this.writePositions();
  }

  // Moves every streak down by FALL_SPEED * dt. A streak that drops below 0 re-enters at CEILING
  // at a new random x, z. The origin is the player's XZ position.
  update(dt: number, playerX: number, playerZ: number): void {
    this.originX = playerX;
    this.originZ = playerZ;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      let y = (this.local[j + 1] ?? 0) - dt * FALL_SPEED;
      if (y < 0) {
        // One wrap per frame, as legacy. The caller keeps dt small.
        y += CEILING;
        this.local[j] = this.rng.range(-HALF_SPREAD, HALF_SPREAD);
        this.local[j + 2] = this.rng.range(-HALF_SPREAD, HALF_SPREAD);
      }
      this.local[j + 1] = y;
    }
    this.writePositions();
  }

  private writePositions(): void {
    const p = this.positions;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      const x = (this.local[j] ?? 0) + this.originX;
      const y = this.local[j + 1] ?? 0;
      const z = (this.local[j + 2] ?? 0) + this.originZ;
      const k = i * 6;
      p[k] = x;
      p[k + 1] = y;
      p[k + 2] = z;
      p[k + 3] = x + STREAK_DX;
      p[k + 4] = y + STREAK_DY;
      p[k + 5] = z;
    }
  }
}

// The caller decides visibility (legacy: Substation, High quality, playing). The scene-side
// position buffer is marked dirty before each render.
export function buildRain(
  scene: THREE.Scene,
  field: RainField,
): { object: THREE.LineSegments; setVisible(v: boolean): void } {
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(field.positions, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  const mat = new THREE.LineBasicMaterial({
    color: 0xaec6e0,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const object = new THREE.LineSegments(geo, mat);
  object.frustumCulled = false;
  object.visible = false;
  object.onBeforeRender = () => {
    attr.needsUpdate = true;
  };
  scene.add(object);
  return {
    object,
    setVisible(v: boolean): void {
      object.visible = v;
    },
  };
}
