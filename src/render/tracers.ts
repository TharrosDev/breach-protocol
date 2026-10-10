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
    // In-place compaction: no new array per frame.
    let w = 0;
    for (const t of this.tracers) {
      t.life -= dt;
      if (t.life > 0) this.tracers[w++] = t;
    }
    this.tracers.length = w;
  }
}

interface TracerSlot {
  line: THREE.Line;
  position: THREE.BufferAttribute;
  glow: THREE.Mesh | null;
}

// One Line per live tracer, taken from a pool of slots. A slot keeps its geometry (two vertices, rewritten in place)
// and its materials, so a shot allocates no GPU resources after the pool has warmed up. A slot is in the scene only
// while its tracer is alive.
export function buildTracerMeshes(
  scene: THREE.Scene,
  pool: TracerPool,
  glow = false,
): { sync(): void; dispose(): void } {
  const active = new Map<object, TracerSlot>();
  const free: TracerSlot[] = [];
  const all: TracerSlot[] = [];
  const glowGeo = new THREE.BoxGeometry(1, 1, 1);
  glowGeo.translate(0, 0, -0.5);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  const makeSlot = (): TracerSlot => {
    const position = new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', position);
    // The segment moves between uses, so the bounds are refreshed on each use.
    const material = new THREE.LineBasicMaterial({
      color: TRACER_COLOR,
      transparent: true,
      opacity: TRACER_OPACITY,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    let gm: THREE.Mesh | null = null;
    if (glow) {
      gm = new THREE.Mesh(
        glowGeo,
        new THREE.MeshBasicMaterial({
          color: TRACER_COLOR,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      gm.frustumCulled = false;
    }
    const slot = { line, position, glow: gm };
    all.push(slot);
    return slot;
  };

  const release = (tracer: object, slot: TracerSlot): void => {
    scene.remove(slot.line);
    if (slot.glow) scene.remove(slot.glow);
    active.delete(tracer);
    free.push(slot);
  };

  return {
    sync(): void {
      for (const [tracer, slot] of active) {
        if ((tracer as Tracer).life <= 0) release(tracer, slot);
      }
      for (const tracer of pool.items) {
        let slot = active.get(tracer);
        if (slot === undefined) {
          slot = free.pop() ?? makeSlot();
          active.set(tracer, slot);
          slot.position.setXYZ(0, tracer.start.x, tracer.start.y, tracer.start.z);
          slot.position.setXYZ(1, tracer.end.x, tracer.end.y, tracer.end.z);
          slot.position.needsUpdate = true;
          (slot.line.material as THREE.LineBasicMaterial).color.setHex(tracer.color);
          scene.add(slot.line);
          if (slot.glow) {
            a.set(tracer.start.x, tracer.start.y, tracer.start.z);
            b.set(tracer.end.x, tracer.end.y, tracer.end.z);
            (slot.glow.material as THREE.MeshBasicMaterial).color.setHex(tracer.color);
            slot.glow.position.copy(a);
            slot.glow.lookAt(b);
            slot.glow.scale.set(0.035, 0.035, a.distanceTo(b));
            scene.add(slot.glow);
          }
        }
        if (slot.glow) {
          (slot.glow.material as THREE.MeshBasicMaterial).opacity =
            0.5 * Math.min(1, tracer.life / TRACER_LIFE);
        }
      }
    },
    dispose(): void {
      for (const [tracer, slot] of [...active]) release(tracer, slot);
      for (const slot of all) {
        slot.line.geometry.dispose();
        (slot.line.material as THREE.Material).dispose();
        if (slot.glow) (slot.glow.material as THREE.Material).dispose();
      }
      all.length = 0;
      free.length = 0;
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
