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
  readonly capacity: number;
  // Bumped on every add, so a view can tell when to rebuild.
  version = 0;

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
    this.version += 1;
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

// One InstancedMesh for every decal. Holes never move, so the matrices are rebuilt only when one is added. Geometry,
// material and texture are created on the first hole, so an empty scene does no work. makeTexture is supplied by the
// caller, which keeps DOM access out of this module.
export function buildHoleMeshes(
  scene: THREE.Scene,
  field: HoleField,
  makeTexture: () => THREE.Texture,
): { sync(): void; dispose(): void } {
  interface Assets {
    geometry: THREE.PlaneGeometry;
    material: THREE.MeshBasicMaterial;
    mesh: THREE.InstancedMesh;
  }
  let assets: Assets | null = null;
  let built = 0;
  const dummy = new THREE.Object3D();

  const getAssets = (): Assets => {
    if (!assets) {
      const geometry = new THREE.PlaneGeometry(DECAL_SIZE, DECAL_SIZE);
      const material = new THREE.MeshBasicMaterial({
        map: makeTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, field.capacity);
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      assets = { geometry, material, mesh };
    }
    return assets;
  };

  return {
    sync(): void {
      if (field.version === built) return;
      built = field.version;
      const { mesh } = getAssets();
      const items = field.items;
      const n = Math.min(items.length, field.capacity);
      for (let i = 0; i < n; i++) {
        const hole = items[i];
        if (!hole) continue;
        dummy.position.set(hole.pos.x, hole.pos.y, hole.pos.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.lookAt(hole.target.x, hole.target.y, hole.target.z);
        // Each decal gets its own roll and size, from its position, so a burst does not stamp one picture.
        const k = Math.sin(hole.pos.x * 12.9898 + hole.pos.y * 78.233 + hole.pos.z * 37.719) * 43758.5453;
        const r = k - Math.floor(k);
        dummy.rotateZ(r * Math.PI * 2);
        dummy.scale.setScalar(0.7 + r * 0.7);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose(): void {
      if (assets) {
        scene.remove(assets.mesh);
        assets.mesh.dispose();
        assets.material.map?.dispose();
        assets.material.dispose();
        assets.geometry.dispose();
        assets = null;
      }
    },
  };
}
