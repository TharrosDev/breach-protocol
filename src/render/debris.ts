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
  private readonly capacity: number;

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
    }
    this.pieces = this.pieces.filter((d) => d.life > 0);
  }
}

// One Mesh per live piece, kept in a grow-only pool. Meshes past the live count are hidden, not destroyed.
export function buildDebrisMeshes(scene: THREE.Scene, field: DebrisField): { sync(): void; dispose(): void } {
  const geometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
  const material = new THREE.MeshStandardMaterial({ color: COLOR, roughness: 0.9 });
  const meshes: THREE.Mesh[] = [];

  return {
    sync(): void {
      const items = field.items;
      for (let i = 0; i < items.length; i++) {
        const d = items[i];
        if (!d) continue;
        let mesh = meshes[i];
        if (!mesh) {
          mesh = new THREE.Mesh(geometry, material);
          scene.add(mesh);
          meshes.push(mesh);
        }
        mesh.visible = true;
        mesh.position.set(d.pos.x, d.pos.y, d.pos.z);
        mesh.rotation.set(d.rot.x, 0, d.rot.z);
        mesh.scale.setScalar(d.scale);
      }
      for (let i = items.length; i < meshes.length; i++) {
        const hidden = meshes[i];
        if (hidden) hidden.visible = false;
      }
    },
    dispose(): void {
      for (const mesh of meshes) scene.remove(mesh);
      meshes.length = 0;
      geometry.dispose();
      material.dispose();
    },
  };
}
