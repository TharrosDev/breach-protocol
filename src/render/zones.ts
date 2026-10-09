// Capture-zone visuals: flat ring, ground disc, sky beam and an optional point light. Geometry and
// materials follow index.html:1012-1031 (makeZone), the palettes follow 481-484 (ZONE_PALETTE), and the
// per-frame colour sync follows 2578-2579. No DOM is touched here: the caller owns the scene and the loop.
import * as THREE from 'three';

export type ZoneStatus = 'idle' | 'capturing' | 'contested' | 'captured';

// The fields the visual reads. A sim Zone with these fields satisfies it structurally.
export interface ZoneRenderInput {
  x: number;
  z: number;
  status: ZoneStatus;
}

export type ZonePaletteMode = 'normal' | 'colourblind';

// index.html:481-484. The colour-blind variant is the one selected by the Display setting.
export const ZONE_PALETTE: Readonly<Record<ZonePaletteMode, Readonly<Record<ZoneStatus, number>>>> = {
  normal: { idle: 0xff4d4d, capturing: 0x58b7ff, contested: 0xffb020, captured: 0x4dff9a },
  colourblind: { idle: 0xe6e6e6, capturing: 0x9ad0ff, contested: 0xffb000, captured: 0x2f6bff },
};

const RING_INNER = 4.0;
const RING_OUTER = 4.4;
const DISC_RADIUS = 4.2;
const BEAM_RADIUS = 0.1;
const BEAM_HEIGHT = 12;
const BEAM_Y = 6;
const DISC_Y = 0.04;
const RING_Y = 0.05;
const LIGHT_Y = 3.2;
const LIGHT_INTENSITY = 2.5;
const LIGHT_DISTANCE = 16;
const LIGHT_DECAY = 2;
const IDLE_COLOUR = ZONE_PALETTE.normal.idle;

export function zoneColour(status: ZoneStatus, colourblind: boolean): number {
  return colourblind ? ZONE_PALETTE.colourblind[status] : ZONE_PALETTE.normal[status];
}

export interface ZoneVisual {
  // Sets the ring, disc, beam and light colour. Writes only when the colour changes.
  update(zone: ZoneRenderInput, colourblind: boolean): void;
  // Removes every object from the scene and frees its geometry and materials.
  dispose(): void;
}

// index.html:1012-1031. The light is only added at High quality, so the caller passes withLight.
export function buildZoneVisual(scene: THREE.Scene, zone: ZoneRenderInput, withLight: boolean): ZoneVisual {
  const ringGeo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 48);
  const discGeo = new THREE.CircleGeometry(DISC_RADIUS, 48);
  const beamGeo = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 8, 1, true);
  const ringMat = new THREE.MeshBasicMaterial({
    color: IDLE_COLOUR,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  const discMat = new THREE.MeshBasicMaterial({
    color: IDLE_COLOUR,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beamMat = new THREE.MeshBasicMaterial({
    color: IDLE_COLOUR,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });

  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(zone.x, RING_Y, zone.z);

  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(zone.x, DISC_Y, zone.z);

  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(zone.x, BEAM_Y, zone.z);

  scene.add(ring, disc, beam);

  let light: THREE.PointLight | null = null;
  if (withLight) {
    light = new THREE.PointLight(IDLE_COLOUR, LIGHT_INTENSITY, LIGHT_DISTANCE, LIGHT_DECAY);
    light.position.set(zone.x, LIGHT_Y, zone.z);
    scene.add(light);
  }

  // null until the first update, so the first call always writes the colour.
  let colour: number | null = null;

  return {
    update(current, colourblind): void {
      const want = zoneColour(current.status, colourblind);
      if (want === colour) return;
      colour = want;
      ringMat.color.setHex(want);
      discMat.color.setHex(want);
      beamMat.color.setHex(want);
      if (light) light.color.setHex(want);
    },
    dispose(): void {
      scene.remove(ring, disc, beam);
      ringGeo.dispose();
      discGeo.dispose();
      beamGeo.dispose();
      ringMat.dispose();
      discMat.dispose();
      beamMat.dispose();
      if (light) {
        scene.remove(light);
        light = null;
      }
    },
  };
}
