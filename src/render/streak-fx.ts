// Short effects for the two newer killstreaks: the Aegis shield bubble that flashes around the player when it goes
// up, and the EMP pulse that rolls out across the ground. Both are one-shot meshes that fade and remove themselves.
import * as THREE from 'three';
import type { Vec3 } from '../core/math';

export const SHIELD_FLASH_SECONDS = 0.8;
export const EMP_PULSE_SECONDS = 1.3;
// The EMP ring grows to this radius (m), well past the edge of every map.
export const EMP_RING_RADIUS = 70;

// Pure curves, so the unit tests can check them without a renderer.
export function shieldFlashAt(t: number): { scale: number; opacity: number } {
  const k = Math.min(1, Math.max(0, t / SHIELD_FLASH_SECONDS));
  // The bubble snaps out fast, then eases to its full size while it fades.
  const ease = 1 - (1 - k) * (1 - k);
  return { scale: 0.5 + 1.1 * ease, opacity: 0.55 * (1 - k) * (1 - k) };
}

export function empRingAt(t: number): { radius: number; opacity: number } {
  const k = Math.min(1, Math.max(0, t / EMP_PULSE_SECONDS));
  const ease = 1 - (1 - k) * (1 - k);
  return { radius: 1 + (EMP_RING_RADIUS - 1) * ease, opacity: 0.85 * (1 - k) };
}

interface Active {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  kind: 'shield' | 'shieldFrame' | 'emp';
  delay: number;
}

export interface StreakFx {
  shieldFlash(pos: Vec3): void;
  empPulse(pos: Vec3): void;
  update(dt: number): void;
  // Number of effects still running (for tests).
  readonly live: number;
  dispose(): void;
}

export function createStreakFx(scene: THREE.Scene): StreakFx {
  const bubble = new THREE.SphereGeometry(1, 20, 14);
  const frame = new THREE.IcosahedronGeometry(1, 1);
  const ring = new THREE.RingGeometry(0.94, 1, 72);
  let active: Active[] = [];

  const spawn = (
    geometry: THREE.BufferGeometry,
    kind: Active['kind'],
    colour: number,
    pos: Vec3,
    wire: boolean,
    delay = 0,
  ): void => {
    const material = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      wireframe: wire,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.frustumCulled = false;
    if (kind === 'emp') mesh.rotation.x = -Math.PI / 2;
    mesh.visible = delay <= 0;
    scene.add(mesh);
    active.push({ mesh, material, age: 0, kind, delay });
  };

  const free = (a: Active): void => {
    scene.remove(a.mesh);
    a.material.dispose();
  };

  return {
    shieldFlash(pos) {
      const centre = { x: pos.x, y: pos.y + 1, z: pos.z };
      spawn(bubble, 'shield', 0x58b7ff, centre, false);
      spawn(frame, 'shieldFrame', 0xbfe6ff, centre, true);
    },
    empPulse(pos) {
      spawn(ring, 'emp', 0x9ad7ff, { x: pos.x, y: 0.3, z: pos.z }, false);
      // A second ring trails the first.
      spawn(ring, 'emp', 0xffffff, { x: pos.x, y: 0.5, z: pos.z }, false, 0.18);
    },
    update(dt) {
      for (const a of active) {
        if (a.delay > 0) {
          a.delay -= dt;
          if (a.delay > 0) continue;
          a.mesh.visible = true;
        }
        a.age += dt;
        if (a.kind === 'emp') {
          const e = empRingAt(a.age);
          a.mesh.scale.setScalar(e.radius);
          a.material.opacity = e.opacity;
        } else {
          const s = shieldFlashAt(a.age);
          a.mesh.scale.setScalar(s.scale * 1.7);
          a.material.opacity = a.kind === 'shieldFrame' ? Math.min(0.8, s.opacity * 1.6) : s.opacity;
        }
      }
      active = active.filter((a) => {
        const life = a.kind === 'emp' ? EMP_PULSE_SECONDS : SHIELD_FLASH_SECONDS;
        const alive = a.age < life;
        if (!alive) free(a);
        return alive;
      });
    },
    get live() {
      return active.length;
    },
    dispose() {
      for (const a of active) free(a);
      active = [];
      bubble.dispose();
      frame.dispose();
      ring.dispose();
    },
  };
}
