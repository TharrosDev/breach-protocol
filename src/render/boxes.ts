import * as THREE from 'three';
import type { MapBox, MapDef } from '../content/maps/types';
import type { CollisionWorld } from '../sim/collision';

// Phase 1 scene: sky, fog, ground, sun, and one grey box mesh per collider. No textures.
// Each map box is registered in the collision world here, so the world and the meshes always match.
export function buildBoxes(scene: THREE.Scene, map: MapDef, world: CollisionWorld): void {
  scene.background = new THREE.Color(map.sky.horizon);
  scene.fog = new THREE.Fog(map.sky.horizon, map.fog[0], map.fog[1]);

  const hemi = new THREE.HemisphereLight(0xdfe8ff, map.ground, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(map.sun, 2.2);
  sun.position.set(40, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 220;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ color: map.ground, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.9 });
  for (const b of map.boxes) {
    world.add(b, { breakable: b.breakable });
    scene.add(boxMesh(b, wallMat));
  }

  const trimMat = new THREE.MeshStandardMaterial({ color: 0x5c6670, roughness: 0.7 });
  for (const r of map.roofs) {
    scene.add(boxMesh(r, trimMat));
  }
}

// A mesh for a box, sitting on its min.y. Shared with game.ts for the dummy targets.
export function boxMesh(b: MapBox, material: THREE.Material): THREE.Mesh {
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const sz = b.max.z - b.min.z;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.position.set((b.min.x + b.max.x) / 2, b.min.y + sy / 2, (b.min.z + b.max.z) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
