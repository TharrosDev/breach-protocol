// Meshes and textures for the FX fields. The field modules stay free of THREE, so the pieces that
// need it live here: the casing mesh pool and the bullet-hole canvas texture.
import * as THREE from 'three';
import type { CasingField } from './casings';

// Legacy CASING_GEO and CASING_MAT (index.html:1431-1432).
const CASING_SIZE = { x: 0.02, y: 0.02, z: 0.05 };
const CASING_COLOR = 0xc9a13b;

// One mesh per live casing, in a grow-only pool. Meshes past the live count are hidden, not destroyed.
export function buildCasingMeshes(scene: THREE.Scene, field: CasingField): { sync(): void; dispose(): void } {
  const geometry = new THREE.BoxGeometry(CASING_SIZE.x, CASING_SIZE.y, CASING_SIZE.z);
  const material = new THREE.MeshStandardMaterial({ color: CASING_COLOR, metalness: 0.9, roughness: 0.35 });
  const meshes: THREE.Mesh[] = [];

  return {
    sync(): void {
      const items = field.items;
      for (let i = 0; i < items.length; i++) {
        const c = items[i];
        if (!c) continue;
        let mesh = meshes[i];
        if (!mesh) {
          mesh = new THREE.Mesh(geometry, material);
          scene.add(mesh);
          meshes.push(mesh);
        }
        mesh.visible = true;
        mesh.position.set(c.pos.x, c.pos.y, c.pos.z);
        // Legacy updCasings spins about y (index.html:1450).
        mesh.rotation.set(0, c.spin, 0);
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

// Legacy TEX_FX.hole (index.html:1127-1132): a 64 px dark radial gradient.
export function makeHoleTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g !== null) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    grad.addColorStop(0, 'rgba(12,10,8,1)');
    grad.addColorStop(0.45, 'rgba(30,26,22,0.9)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
