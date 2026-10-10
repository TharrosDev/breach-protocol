import * as THREE from 'three';
import type { Vec2, Vec3 } from '../core/math';
import type { Rng } from '../core/rng';

// Explosion debris ported from the legacy debrisBurst and updDebris (index.html:3173-3198).
// rot.x and rot.z are the accumulated spin about x and z. Only buildDebrisMeshes touches the scene.

export interface DebrisPiece {
  pos: Vec3;
  vel: Vec3;
  rot: Vec2;
  scale: number;
  life: number;
}

const DEFAULT_MAX = 90;
const GRAVITY = 16;
const FLOOR_Y = 0.07;
const BOUNCE_Y = -0.35;
const FRICTION = 0.6;
const SPIN_X = 9;
const SPIN_Z = 7;
const CUBE_SIZE = 0.14;
const COLOR = 0x5a4c3e;
const TAU = Math.PI * 2;

export class DebrisField {
  private pieces: DebrisPiece[] = [];
  readonly capacity: number;

  constructor(max = DEFAULT_MAX) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError('DebrisField max must be a positive integer');
    }
    this.capacity = max;
  }

  get items(): readonly DebrisPiece[] {
    return this.pieces;
  }

  // Draw order matches legacy: scale, angle, speed, vertical kick, life. Oldest pieces are dropped past the cap.
  burst(p: Vec3, n: number, rng: Rng): void {
    for (let k = 0; k < n; k++) {
      const scale = 0.5 + rng.next();
      const a = rng.next() * TAU;
      const s = 3 + rng.next() * 5;
      const vy = 4 + rng.next() * 6;
      const life = 1.4 + rng.next() * 0.8;
      this.pieces.push({
        pos: { x: p.x, y: p.y, z: p.z },
        vel: { x: Math.cos(a) * s, y: vy, z: Math.sin(a) * s },
        rot: { x: 0, z: 0 },
        scale,
        life,
      });
    }
    if (this.pieces.length > this.capacity) {
      this.pieces.splice(0, this.pieces.length - this.capacity);
    }
  }

  update(dt: number): void {
    let w = 0;
    for (const d of this.pieces) {
      d.vel.y -= GRAVITY * dt;
      d.pos.x += d.vel.x * dt;
      d.pos.y += d.vel.y * dt;
      d.pos.z += d.vel.z * dt;
      d.rot.x += dt * SPIN_X;
      d.rot.z += dt * SPIN_Z;
      if (d.pos.y < FLOOR_Y) {
        d.pos.y = FLOOR_Y;
        d.vel.y *= BOUNCE_Y;
        d.vel.x *= FRICTION;
        d.vel.z *= FRICTION;
      }
      d.life -= dt;
      if (d.life > 0) this.pieces[w++] = d;
    }
    this.pieces.length = w;
  }
}

// One InstancedMesh for every piece: a single draw call whatever the count. Only the live pieces are drawn.
export function buildDebrisMeshes(scene: THREE.Scene, field: DebrisField): { sync(): void; dispose(): void } {
  const geometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
  const material = new THREE.MeshStandardMaterial({ color: COLOR, roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(geometry, material, field.capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  const dummy = new THREE.Object3D();

  return {
    sync(): void {
      const items = field.items;
      const n = Math.min(items.length, field.capacity);
      mesh.count = n;
      // With no live pieces the mesh is hidden: no draw call and no matrix upload.
      mesh.visible = n > 0;
      if (n === 0) return;
      for (let i = 0; i < n; i++) {
        const d = items[i];
        if (!d) continue;
        dummy.position.set(d.pos.x, d.pos.y, d.pos.z);
        dummy.rotation.set(d.rot.x, 0, d.rot.z);
        dummy.scale.setScalar(d.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose(): void {
      scene.remove(mesh);
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
