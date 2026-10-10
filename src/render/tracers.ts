import * as THREE from 'three';
import type { Vec3 } from '../core/math';

// Tracer lines and explosion shockwave rings, ported from the legacy tracer (index.html:1368-1372)
// and shockwave (index.html:3199-3205). The pure classes are THREE-free; the build functions own the meshes.

export interface Tracer {
  start: Vec3;
  end: Vec3;
  color: number;
  life: number;
}

const TRACER_LIFE = 0.06;
const TRACER_COLOR = 0xffe7a0;
const TRACER_OPACITY = 0.85;

export function tracerSegment(a: Vec3, b: Vec3, color = TRACER_COLOR): Tracer {
  return {
    start: { x: a.x, y: a.y, z: a.z },
    end: { x: b.x, y: b.y, z: b.z },
    color,
    life: TRACER_LIFE,
  };
}

export class TracerPool {
  private tracers: Tracer[] = [];

  get items(): readonly Tracer[] {
    return this.tracers;
  }

  // Stores a copy, so the caller's segment can be reused safely.
  add(seg: Tracer): void {
    this.tracers.push({
      start: { x: seg.start.x, y: seg.start.y, z: seg.start.z },
      end: { x: seg.end.x, y: seg.end.y, z: seg.end.z },
      color: seg.color,
      life: seg.life,
    });
  }

  update(dt: number): void {
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);
  }
}

// One Line per live tracer. Each line is removed and disposed on expiry.
export function buildTracerMeshes(
  scene: THREE.Scene,
  pool: TracerPool,
  glow = false,
): { sync(): void; dispose(): void } {
  const lines = new Map<object, THREE.Line>();
  const glows = new Map<object, THREE.Mesh>();
  const glowGeo = new THREE.BoxGeometry(1, 1, 1);
  glowGeo.translate(0, 0, -0.5);

  const removeLine = (line: THREE.Line): void => {
    scene.remove(line);
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
  };

  return {
    sync(): void {
      const live = new Set<object>(pool.items);
      for (const [tracer, line] of lines) {
        if (!live.has(tracer)) {
          removeLine(line);
          lines.delete(tracer);
          const gm = glows.get(tracer);
          if (gm) {
            scene.remove(gm);
            (gm.material as THREE.Material).dispose();
            glows.delete(tracer);
          }
        }
      }
      for (const tracer of pool.items) {
        const gm0 = glows.get(tracer);
        if (gm0)
          (gm0.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.min(1, tracer.life / TRACER_LIFE);
        if (lines.has(tracer)) continue;
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(tracer.start.x, tracer.start.y, tracer.start.z),
          new THREE.Vector3(tracer.end.x, tracer.end.y, tracer.end.z),
        ]);
        const material = new THREE.LineBasicMaterial({
          color: tracer.color,
          transparent: true,
          opacity: TRACER_OPACITY,
        });
        const line = new THREE.Line(geometry, material);
        scene.add(line);
        lines.set(tracer, line);
        if (glow) {
          const a = new THREE.Vector3(tracer.start.x, tracer.start.y, tracer.start.z);
          const b = new THREE.Vector3(tracer.end.x, tracer.end.y, tracer.end.z);
          const gm = new THREE.Mesh(
            glowGeo,
            new THREE.MeshBasicMaterial({
              color: tracer.color,
              transparent: true,
              opacity: 0.5,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              fog: false,
            }),
          );
          gm.position.copy(a);
          gm.lookAt(b);
          gm.scale.set(0.035, 0.035, a.distanceTo(b));
          scene.add(gm);
          glows.set(tracer, gm);
        }
      }
    },
    dispose(): void {
      for (const line of lines.values()) removeLine(line);
      lines.clear();
      for (const gm of glows.values()) {
        scene.remove(gm);
        (gm.material as THREE.Material).dispose();
      }
      glows.clear();
      glowGeo.dispose();
    },
  };
}

export interface ShockwaveRing {
  pos: Vec3;
  radius: number;
  age: number;
  life: number;
  scale: number;
  opacity: number;
}

const SHOCK_LIFE = 0.45;
const SHOCK_Y = 0.12;
const SHOCK_OPACITY = 0.8;
const SHOCK_START_SCALE = 0.5;

// Scale and opacity at age fraction k in [0, 1]. Legacy: scale 0.5 + k*r, opacity 0.8*(1-k).
export function shockwaveAt(k: number, radius: number): { scale: number; opacity: number } {
  return {
    scale: SHOCK_START_SCALE + k * radius,
    opacity: SHOCK_OPACITY * (1 - k),
  };
}

export class ShockwaveField {
  private rings: ShockwaveRing[] = [];

  get items(): readonly ShockwaveRing[] {
    return this.rings;
  }

  add(p: Vec3, r: number): void {
    const start = shockwaveAt(0, r);
    this.rings.push({
      pos: { x: p.x, y: SHOCK_Y, z: p.z },
      radius: r,
      age: 0,
      life: SHOCK_LIFE,
      scale: start.scale,
      opacity: start.opacity,
    });
  }

  update(dt: number): void {
    for (const ring of this.rings) {
      ring.age += dt;
      const k = Math.min(ring.age / ring.life, 1);
      const state = shockwaveAt(k, ring.radius);
      ring.scale = state.scale;
      ring.opacity = state.opacity;
    }
    this.rings = this.rings.filter((ring) => ring.age < ring.life);
  }
}

// Ring geometry is shared; each ring owns its material because opacity differs per ring.
export function buildShockwaveMeshes(
  scene: THREE.Scene,
  field: ShockwaveField,
): { sync(): void; dispose(): void } {
  const geometry = new THREE.RingGeometry(0.85, 1, 40);
  geometry.rotateX(-Math.PI / 2);
  const meshes = new Map<object, THREE.Mesh>();

  return {
    sync(): void {
      const live = new Set<object>(field.items);
      for (const [ring, mesh] of meshes) {
        if (!live.has(ring)) {
          scene.remove(mesh);
          (mesh.material as THREE.Material).dispose();
          meshes.delete(ring);
        }
      }
      for (const ring of field.items) {
        let mesh = meshes.get(ring);
        if (!mesh) {
          const material = new THREE.MeshBasicMaterial({
            color: 0xffe0b0,
            transparent: true,
            opacity: SHOCK_OPACITY,
            depthWrite: false,
          });
          mesh = new THREE.Mesh(geometry, material);
          scene.add(mesh);
          meshes.set(ring, mesh);
        }
        mesh.position.set(ring.pos.x, ring.pos.y, ring.pos.z);
        mesh.scale.setScalar(ring.scale);
        (mesh.material as THREE.MeshBasicMaterial).opacity = ring.opacity;
      }
    },
    dispose(): void {
      for (const mesh of meshes.values()) {
        scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      }
      meshes.clear();
      geometry.dispose();
    },
  };
}
