// Counts the scene objects buildMap and buildBlobs create (draw calls before the sky, humans and effects).
// Run: npx tsx scripts/count-draws.ts
import * as THREE from 'three';
import { getMap } from '../src/content/maps';
import { createRng } from '../src/core/rng';
import { CollisionWorld } from '../src/sim/collision';
import { buildMap } from '../src/render/map-builder';
import { buildBlobs } from '../src/render/blobs';

// buildBlobs draws a canvas texture, so give it a stub canvas under node.
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => ({ getContext: () => null, width: 0, height: 0 }),
};

for (const id of ['compound', 'depot', 'substation'] as const) {
  const scene = new THREE.Scene();
  const world = new CollisionWorld();
  const def = getMap(id);
  const h = buildMap(def, scene, world, createRng(1));
  const boxes = world.footprints();
  buildBlobs(
    scene,
    boxes.map((b) => ({ ...b, breakable: false })),
  );
  let meshes = 0;
  let tris = 0;
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes++;
      const g = o.geometry as THREE.BufferGeometry;
      tris += (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
    }
  });
  const legacyMeshes =
    def.boxes.length +
    def.roofs.length +
    h.sandbags.length +
    h.barrels.length +
    h.crates.length +
    1 +
    6 +
    boxes.length;
  console.log(
    `${id}: ${String(meshes)} meshes (${String(Math.round(tris))} tris); one-mesh-per-box layout would be about ${String(legacyMeshes)}`,
  );
}
