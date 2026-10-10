// Meshes and textures for the FX fields. The field modules stay free of THREE, so the pieces that
// need it live here: the casing mesh pool and the bullet-hole canvas texture.
import * as THREE from 'three';
import { cachedTexture } from './texture-cache';
import type { CasingField } from './casings';

// Legacy CASING_GEO and CASING_MAT (index.html:1431-1432).
const CASING_SIZE = { x: 0.02, y: 0.02, z: 0.05 };
const CASING_COLOR = 0xc9a13b;

// One InstancedMesh for every casing: a single draw call. Only the live casings are drawn.
export function buildCasingMeshes(scene: THREE.Scene, field: CasingField): { sync(): void; dispose(): void } {
  const geometry = new THREE.CylinderGeometry(CASING_SIZE.x * 0.4, CASING_SIZE.x * 0.4, CASING_SIZE.z, 8);
  geometry.rotateX(Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color: CASING_COLOR, metalness: 0.9, roughness: 0.35 });
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
      mesh.visible = n > 0;
      if (n === 0) return;
      for (let i = 0; i < n; i++) {
        const c = items[i];
        if (!c) continue;
        dummy.position.set(c.pos.x, c.pos.y, c.pos.z);
        // Legacy updCasings spins about y (index.html:1450).
        dummy.rotation.set(c.spin * 1.7, c.spin, c.spin * 0.6);
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

// Legacy TEX_FX.hole (index.html:1127-1132): a 64 px dark radial gradient.
// A bullet hole: a dark crater with a scorched halo, a few radial cracks and chipped edges. 128 px.
export function makeHoleTexture(): THREE.CanvasTexture {
  return cachedTexture('hole', drawHoleTexture);
}

function drawHoleTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g !== null) {
    const c = size / 2;
    const halo = g.createRadialGradient(c, c, 0, c, c, c);
    halo.addColorStop(0, 'rgba(10,8,6,0.95)');
    halo.addColorStop(0.22, 'rgba(20,17,14,0.85)');
    halo.addColorStop(0.5, 'rgba(40,34,28,0.35)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, size, size);
    // Cracks: short jittered rays (deterministic).
    g.strokeStyle = 'rgba(8,6,5,0.75)';
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.sin(i * 3.1) * 0.3;
      const len = 18 + ((i * 37) % 22);
      g.lineWidth = 1 + (i % 3) * 0.6;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 9, c + Math.sin(a) * 9);
      g.lineTo(c + Math.cos(a + 0.12) * (9 + len * 0.6), c + Math.sin(a + 0.12) * (9 + len * 0.6));
      g.lineTo(c + Math.cos(a - 0.06) * (9 + len), c + Math.sin(a - 0.06) * (9 + len));
      g.stroke();
    }
    // Bright chipped rim just outside the crater.
    g.strokeStyle = 'rgba(190,180,160,0.28)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c, c, 11, 0.4, 3.9);
    g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.95)';
    g.beginPath();
    g.arc(c, c, 6, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A soft round sprite for particles and puffs: white centre fading to transparent. Null without a document.
export function makeSoftDotTexture(inner = 0.0, size = 64): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  return cachedTexture(`dot:${String(inner)}:${String(size)}`, () => drawSoftDotTexture(inner, size));
}

function drawSoftDotTexture(inner: number, size: number): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (g === null) return null;
  const c = size / 2;
  const grad = g.createRadialGradient(c, c, c * inner, c, c, c);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
