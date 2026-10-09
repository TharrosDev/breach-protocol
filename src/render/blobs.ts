import * as THREE from 'three';
import type { Vec3 } from '../core/math';

// The collider fields the shadows need. CollisionWorld does not expose its boxes, so the caller supplies them.
export interface BlobBox {
  min: Vec3;
  max: Vec3;
  breakable: boolean;
}

// Props at or below this height get a contact shadow (legacy addBlobs, index.html:3099-3110).
const MAX_HEIGHT = 2.5;
const MARGIN = 0.9;

// Soft contact shadows under low, non-breakable colliders so they sit on the ground.
export function buildBlobs(scene: THREE.Scene, boxes: Iterable<BlobBox>): THREE.Object3D[] {
  const mat = new THREE.MeshBasicMaterial({
    map: makeBlobTexture(),
    transparent: true,
    depthWrite: false,
  });

  const out: THREE.Object3D[] = [];
  for (const c of boxes) {
    if (c.breakable || c.max.y > MAX_HEIGHT) continue;
    const w = c.max.x - c.min.x;
    const d = c.max.z - c.min.z;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w + MARGIN, d + MARGIN), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((c.min.x + c.max.x) / 2, 0.02, (c.min.z + c.max.z) / 2);
    scene.add(m);
    out.push(m);
  }
  return out;
}

// Legacy TEX_FX.blob (index.html:1125-1131): a 128 px radial gradient with an inner radius of 8 px.
function makeBlobTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g !== null) {
    const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.8)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
