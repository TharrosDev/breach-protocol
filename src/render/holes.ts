import * as THREE from 'three';
import type { Vec3 } from '../core/math';

// Bullet-hole decals ported from the legacy addHole (index.html:3131-3141). Each hole stores its
// position and the lookAt target, so the field stays free of THREE objects.

export interface HoleDecal {
  pos: Vec3;
  target: Vec3;
}

const DEFAULT_MAX = 80;
const SURFACE_OFFSET = 0.02;
const DECAL_SIZE = 0.16;

export class HoleField {
  private holes: HoleDecal[] = [];
  private readonly capacity: number;

  constructor(max = DEFAULT_MAX) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError('HoleField max must be a positive integer');
    }
    this.capacity = max;
  }

  get items(): readonly HoleDecal[] {
    return this.holes;
  }

  // Sits just off the surface, on the side the bullet came from; the decal faces p - dir.
  add(p: Vec3, dir: Vec3): void {
    this.holes.push({
      pos: {
        x: p.x - dir.x * SURFACE_OFFSET,
        y: p.y - dir.y * SURFACE_OFFSET,
        z: p.z - dir.z * SURFACE_OFFSET,
      },
      target: { x: p.x - dir.x, y: p.y - dir.y, z: p.z - dir.z },
    });
    if (this.holes.length > this.capacity) {
      this.holes.splice(0, this.holes.length - this.capacity);
    }
  }
}

// Geometry, material and texture are created on the first hole, so an empty scene does no work.
// makeTexture is supplied by the caller, which keeps DOM access out of this module.
export function buildHoleMeshes(
  scene: THREE.Scene,
  field: HoleField,
  makeTexture: () => THREE.Texture,
): { sync(): void; dispose(): void } {
  let assets: { geometry: THREE.PlaneGeometry; material: THREE.MeshBasicMaterial } | null = null;
  const meshes = new Map<object, THREE.Mesh>();

  const getAssets = (): { geometry: THREE.PlaneGeometry; material: THREE.MeshBasicMaterial } => {
    if (!assets) {
      assets = {
        geometry: new THREE.PlaneGeometry(DECAL_SIZE, DECAL_SIZE),
        material: new THREE.MeshBasicMaterial({
          map: makeTexture(),
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      };
    }
    return assets;
  };

  return {
    sync(): void {
      const live = new Set<object>(field.items);
      for (const [hole, mesh] of meshes) {
        if (!live.has(hole)) {
          scene.remove(mesh);
          meshes.delete(hole);
        }
      }
      for (const hole of field.items) {
        if (meshes.has(hole)) continue;
        const { geometry, material } = getAssets();
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
        mesh.position.set(hole.pos.x, hole.pos.y, hole.pos.z);
        mesh.lookAt(hole.target.x, hole.target.y, hole.target.z);
        meshes.set(hole, mesh);
      }
    },
    dispose(): void {
      for (const mesh of meshes.values()) scene.remove(mesh);
      meshes.clear();
      if (assets) {
        assets.material.map?.dispose();
        assets.material.dispose();
        assets.geometry.dispose();
        assets = null;
      }
    },
  };
}
