import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { createRng } from '../../src/core/rng';
import { ZONE_PALETTE, buildZoneVisual, zoneColour, type ZoneStatus } from '../../src/render/zones';
import {
  SMOKE_OPACITY,
  breachMarker,
  droneModel,
  grenadeMesh,
  smokeCloud,
} from '../../src/render/gadget-models';
import { turretModel } from '../../src/render/turret-model';

afterEach(() => {
  vi.restoreAllMocks();
});

const STATUSES: readonly ZoneStatus[] = ['idle', 'capturing', 'contested', 'captured'];

// The first mesh in the scene whose geometry is a RingGeometry, i.e. the zone ring.
function findRing(scene: THREE.Scene): THREE.Mesh {
  const ring = scene.children.find(
    (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.geometry instanceof THREE.RingGeometry,
  );
  if (!ring) throw new Error('ring not found');
  return ring;
}

function findLight(scene: THREE.Scene): THREE.PointLight | undefined {
  return scene.children.find((c): c is THREE.PointLight => c instanceof THREE.PointLight);
}

describe('zoneColour', () => {
  it('returns the normal palette values for each status', () => {
    expect(zoneColour('idle', false)).toBe(0xff4d4d);
    expect(zoneColour('capturing', false)).toBe(0x58b7ff);
    expect(zoneColour('contested', false)).toBe(0xffb020);
    expect(zoneColour('captured', false)).toBe(0x4dff9a);
  });

  it('returns the colour-blind palette values for each status', () => {
    expect(zoneColour('idle', true)).toBe(0xe6e6e6);
    expect(zoneColour('capturing', true)).toBe(0x9ad0ff);
    expect(zoneColour('contested', true)).toBe(0xffb000);
    expect(zoneColour('captured', true)).toBe(0x2f6bff);
  });

  it('exports the same values through ZONE_PALETTE', () => {
    for (const status of STATUSES) {
      expect(zoneColour(status, false)).toBe(ZONE_PALETTE.normal[status]);
      expect(zoneColour(status, true)).toBe(ZONE_PALETTE.colourblind[status]);
    }
  });
});

describe('buildZoneVisual', () => {
  it('adds a point light only when withLight is true, and it follows the zone colour', () => {
    const lit = new THREE.Scene();
    const litZone = buildZoneVisual(lit, { x: 1, z: 2, status: 'idle' }, true);
    litZone.update({ x: 1, z: 2, status: 'captured' }, false);
    const light = findLight(lit);
    expect(light).toBeDefined();
    expect(light?.color.getHex()).toBe(0x4dff9a);
    expect(light?.position.x).toBe(1);
    expect(light?.position.y).toBeCloseTo(3.2);
    expect(light?.position.z).toBe(2);

    const dark = new THREE.Scene();
    const darkZone = buildZoneVisual(dark, { x: 1, z: 2, status: 'idle' }, false);
    darkZone.update({ x: 1, z: 2, status: 'captured' }, false);
    expect(findLight(dark)).toBeUndefined();
  });

  it('places the ring flat at the zone centre', () => {
    const scene = new THREE.Scene();
    buildZoneVisual(scene, { x: -29, z: -28, status: 'idle' }, false);
    const ring = findRing(scene);
    expect(ring.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(ring.position.x).toBe(-29);
    expect(ring.position.y).toBeCloseTo(0.05);
    expect(ring.position.z).toBe(-28);
  });

  it('writes the colour once for a repeated status and again only on a change', () => {
    const scene = new THREE.Scene();
    const visual = buildZoneVisual(scene, { x: 0, z: 0, status: 'idle' }, false);
    const setHex = vi.spyOn(THREE.Color.prototype, 'setHex');
    const zone = { x: 0, z: 0, status: 'idle' as ZoneStatus };

    visual.update(zone, false);
    // Ring, disc and beam: three colour writes on the first update.
    expect(setHex).toHaveBeenCalledTimes(3);

    visual.update(zone, false);
    visual.update(zone, false);
    expect(setHex).toHaveBeenCalledTimes(3);

    zone.status = 'captured';
    visual.update(zone, false);
    expect(setHex).toHaveBeenCalledTimes(6);
    expect(findRing(scene).material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((findRing(scene).material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x4dff9a);
  });

  it('rewrites the colour when the palette mode changes with the status held', () => {
    const scene = new THREE.Scene();
    const visual = buildZoneVisual(scene, { x: 0, z: 0, status: 'captured' }, false);
    visual.update({ x: 0, z: 0, status: 'captured' }, false);
    visual.update({ x: 0, z: 0, status: 'captured' }, true);
    const mat = findRing(scene).material as THREE.MeshBasicMaterial;
    expect(mat.color.getHex()).toBe(0x2f6bff);
  });

  it('removes its objects from the scene on dispose', () => {
    const scene = new THREE.Scene();
    const visual = buildZoneVisual(scene, { x: 0, z: 0, status: 'idle' }, true);
    expect(scene.children.length).toBe(4);
    visual.dispose();
    expect(scene.children.length).toBe(0);
  });
});

describe('grenadeMesh', () => {
  it('shares geometry between calls and uses one material per kind', () => {
    const a = grenadeMesh('frag');
    const b = grenadeMesh('smoke');
    const c = grenadeMesh('frag');
    expect(a.geometry).toBe(b.geometry);
    expect(a.geometry).toBe(c.geometry);
    expect(a.material).toBe(c.material);
    expect(a.material).not.toBe(b.material);
    expect(grenadeMesh('enemyFrag').material).not.toBe(a.material);
  });

  it('uses the legacy colour for each kind', () => {
    expect((grenadeMesh('frag').material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x3d5230);
    expect((grenadeMesh('enemyFrag').material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x7a2b22);
    expect((grenadeMesh('smoke').material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x9aa3ad);
    const flash = grenadeMesh('flash').material as THREE.MeshStandardMaterial;
    expect(flash.color.getHex()).toBe(0xdfe6ee);
    expect(flash.emissive.getHex()).toBe(0x556070);
  });
});

describe('smokeCloud', () => {
  it('builds seven puffs sharing one transparent material at the given position', () => {
    const scene = new THREE.Scene();
    const cloud = smokeCloud(scene, { x: 3, y: 0.5, z: -4 }, createRng(11));
    expect(cloud.group.children.length).toBe(7);
    expect(cloud.group.position.x).toBe(3);
    expect(cloud.group.position.y).toBe(0.5);
    expect(cloud.group.position.z).toBe(-4);
    expect(scene.children).toContain(cloud.group);

    const first = cloud.group.children[0] as THREE.Mesh;
    const mat = first.material as THREE.MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(SMOKE_OPACITY);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    for (const child of cloud.group.children) {
      expect((child as THREE.Mesh).material).toBe(mat);
    }
  });

  it('changes the material opacity through setOpacity', () => {
    const scene = new THREE.Scene();
    const cloud = smokeCloud(scene, { x: 0, y: 0, z: 0 }, createRng(5));
    cloud.setOpacity(0.2);
    const mat = (cloud.group.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(mat.opacity).toBeCloseTo(0.2);
    cloud.setOpacity(0);
    expect(mat.opacity).toBe(0);
  });

  it('gives the same layout for the same seed', () => {
    const scene = new THREE.Scene();
    const a = smokeCloud(scene, { x: 0, y: 0, z: 0 }, createRng(42));
    const b = smokeCloud(scene, { x: 0, y: 0, z: 0 }, createRng(42));
    for (let i = 0; i < 7; i++) {
      const pa = a.group.children[i]?.position;
      const pb = b.group.children[i]?.position;
      expect(pa?.x).toBe(pb?.x);
      expect(pa?.y).toBe(pb?.y);
      expect(pa?.z).toBe(pb?.z);
    }
  });

  it('removes the group from the scene on dispose', () => {
    const scene = new THREE.Scene();
    const cloud = smokeCloud(scene, { x: 0, y: 0, z: 0 }, createRng(1));
    cloud.dispose();
    expect(scene.children).not.toContain(cloud.group);
  });
});

describe('droneModel', () => {
  it('spin increases rotation.y by dt times 12', () => {
    const drone = droneModel();
    expect(drone.group.rotation.y).toBe(0);
    drone.spin(0.1);
    expect(drone.group.rotation.y).toBeGreaterThan(0);
    expect(drone.group.rotation.y).toBeCloseTo(1.2);
    drone.spin(0.1);
    expect(drone.group.rotation.y).toBeCloseTo(2.4);
  });

  it('sets the group position and builds a body plus four rotors', () => {
    const drone = droneModel();
    drone.setPos(1, 5, -2);
    expect(drone.group.position.x).toBe(1);
    expect(drone.group.position.y).toBe(5);
    expect(drone.group.position.z).toBe(-2);
    expect(drone.group.children.length).toBe(5);
  });
});

describe('turretModel', () => {
  it('setYaw sets the head rotation about y', () => {
    const turret = turretModel();
    expect(turret.head.rotation.y).toBe(0);
    turret.setYaw(0.7);
    expect(turret.head.rotation.y).toBeCloseTo(0.7);
    turret.setYaw(-1.2);
    expect(turret.head.rotation.y).toBeCloseTo(-1.2);
  });

  it('keeps the head at legacy height above the base', () => {
    const turret = turretModel();
    expect(turret.head.position.y).toBeCloseTo(0.9);
    expect(turret.group.children).toContain(turret.head);
  });
});

describe('breachMarker', () => {
  it('moves to the given point and flashes between red and dark red', () => {
    const scene = new THREE.Scene();
    const marker = breachMarker(scene);
    marker.setPosition({ x: 2, y: 1, z: 3 });
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.position.x).toBe(2);
    expect(mesh.position.y).toBe(1);
    expect(mesh.position.z).toBe(3);

    const mat = mesh.material as THREE.MeshBasicMaterial;
    marker.flash(0);
    expect(mat.color.getHex()).toBe(0x4a0a0a);
    marker.flash(Math.PI / 2 / 18);
    expect(mat.color.getHex()).toBe(0xff2020);
  });

  it('removes its mesh from the scene on dispose', () => {
    const scene = new THREE.Scene();
    const marker = breachMarker(scene);
    expect(scene.children.length).toBe(1);
    marker.dispose();
    expect(scene.children.length).toBe(0);
  });
});
