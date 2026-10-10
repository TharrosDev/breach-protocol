// Sky, time of day, floating particles and ground detail. Everything is procedural.
// - A gradient sky dome with a sun glow, soft clouds (High) and stars on night maps.
// - A time-of-day preset per map that retunes the sun, hemisphere light and fog.
// - Dust motes, embers or mist drifting around the player.
// - Scattered stones and stains on the ground.
import * as THREE from 'three';
import type { MapDef } from '../content/maps/types';
import type { Rng } from '../core/rng';
import type { CollisionWorld } from '../sim/collision';
import { makeSoftDotTexture } from './fx-assets';
import type { QualityProfile } from './quality';
import { freezeStatic } from './texture-cache';

export interface TimeOfDay {
  // Sun position and intensity.
  sunPos: [number, number, number];
  sunIntensity: number;
  sunColour?: number;
  hemiSky: number;
  // Sky glow colour near the sun.
  glow: number;
  // Floating particle look.
  mote: { colour: number; size: number; rise: number; opacity: number };
}

const COMPOUND: TimeOfDay = {
  // Late afternoon haze.
  sunPos: [55, 62, 28],
  sunIntensity: 2.4,
  hemiSky: 0xdfe8ff,
  glow: 0xffd9a0,
  mote: { colour: 0xfff0d0, size: 0.07, rise: 0.05, opacity: 0.5 },
};

const PRESETS: Record<string, TimeOfDay> = {
  compound: COMPOUND,
  // Cold night under a pale moon.
  substation: {
    sunPos: [-40, 55, -30],
    sunIntensity: 1.5,
    sunColour: 0x9fb4d8,
    hemiSky: 0x9fb4e8,
    glow: 0x7da0d8,
    mote: { colour: 0xb8d0ff, size: 0.06, rise: -0.1, opacity: 0.35 },
  },
  // Low golden sun over the rail yard, with embers.
  depot: {
    sunPos: [85, 24, -35],
    sunIntensity: 2.8,
    hemiSky: 0xffd6b0,
    glow: 0xff9040,
    mote: { colour: 0xff9a40, size: 0.09, rise: 0.5, opacity: 0.8 },
  },
};

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w;
}`;

const SKY_FRAG = `
uniform vec3 horizon; uniform vec3 zenith; uniform vec3 glow; uniform vec3 sunDir; uniform float stars; uniform float clouds; uniform float time;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(horizon, zenith, pow(h, 0.55));
  float sd = max(dot(d, normalize(sunDir)), 0.0);
  col += glow * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.9 + pow(sd, 900.0) * 3.0);
  float haze = exp(-h * 6.0);
  col = mix(col, horizon * 1.15, haze * 0.5);
  if (clouds > 0.5 && d.y > 0.02) {
    vec2 uv = d.xz / (d.y + 0.25) * 1.6 + vec2(time * 0.004, 0.0);
    float c = smoothstep(0.5, 0.85, fbm(uv));
    vec3 cc = mix(horizon * 1.1, glow * 0.8 + 0.2, pow(sd, 3.0) * 0.6);
    col = mix(col, cc, c * 0.45 * smoothstep(0.02, 0.2, d.y));
  }
  if (stars > 0.5 && d.y > 0.0) {
    vec2 g = floor(d.xz / (d.y + 0.2) * 90.0);
    float s = step(0.9965, hash(g));
    col += vec3(s) * smoothstep(0.1, 0.5, d.y) * (0.6 + 0.4 * sin(time * 2.0 + hash(g) * 30.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export interface Atmosphere {
  update(dt: number, px: number, py: number, pz: number): void;
  dispose(): void;
}

function shade(colour: number, k: number): number {
  return new THREE.Color(colour).multiplyScalar(k).getHex();
}

export function buildAtmosphere(
  scene: THREE.Scene,
  def: MapDef,
  profile: QualityProfile,
  rng: Rng,
  world: CollisionWorld,
  sun: THREE.DirectionalLight | null,
  hemi: THREE.HemisphereLight | null,
): Atmosphere {
  const preset = PRESETS[def.id] ?? COMPOUND;
  const disposers: (() => void)[] = [];

  // --- time of day ---------------------------------------------------------------------------------------------
  if (sun) {
    sun.position.set(...preset.sunPos);
    sun.intensity = preset.sunIntensity;
    if (preset.sunColour !== undefined) sun.color.setHex(preset.sunColour);
  }
  if (hemi) hemi.color.setHex(preset.hemiSky);
  if (scene.fog instanceof THREE.Fog) {
    // A hint of the sun glow in the fog gives a sense of air without hiding the map.
    scene.fog.color.lerp(new THREE.Color(preset.glow), 0.12);
    if (scene.background instanceof THREE.Color) scene.background.copy(scene.fog.color);
  }

  // --- sky dome ------------------------------------------------------------------------------------------------
  const skyUniforms = {
    horizon: { value: new THREE.Color(def.sky.horizon).lerp(new THREE.Color(preset.glow), 0.18) },
    zenith: { value: new THREE.Color(def.sky.zenith) },
    glow: { value: new THREE.Color(preset.glow) },
    sunDir: { value: new THREE.Vector3(...preset.sunPos).normalize() },
    stars: { value: def.sky.stars ? 1 : 0 },
    clouds: { value: profile.glow ? 1 : 0 },
    time: { value: 0 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    // The sky is drawn after the opaque scene, at the far plane (the vertex shader sets z = w), with the depth test
    // on. Pixels covered by walls and ground fail the test before the fragment shader runs, so the cloud and star
    // noise is only paid for where the sky is visible. It used to draw first with no depth test, shading every pixel.
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const skyGeo = new THREE.SphereGeometry(300, 24, 16);
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = 1000;
  sky.frustumCulled = false;
  scene.add(sky);
  disposers.push(() => {
    scene.remove(sky);
    skyGeo.dispose();
    skyMat.dispose();
  });

  // --- ground detail: stones and stains --------------------------------------------------------------------------
  const detailCount = profile.groundDetail;
  if (detailCount > 0) {
    const stoneGeo = new THREE.DodecahedronGeometry(0.12, 0);
    const stoneMat = new THREE.MeshStandardMaterial({
      color: shade(def.ground, 1.35),
      roughness: 1,
      flatShading: true,
    });
    const stains = new THREE.CircleGeometry(1, 14);
    stains.rotateX(-Math.PI / 2);
    const stainMat = new THREE.MeshBasicMaterial({
      color: shade(def.ground, 0.55),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, detailCount);
    const patches = new THREE.InstancedMesh(stains, stainMat, Math.ceil(detailCount / 2));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    let si = 0;
    let pi = 0;
    for (let i = 0; i < detailCount * 4 && (si < detailCount || pi < patches.count); i++) {
      const x = rng.range(-55, 55);
      const z = rng.range(-55, 55);
      if (!world.pointFree(x, z, 0.4)) continue;
      if (si < detailCount && i % 3 !== 0) {
        const s = 0.5 + rng.next() * 1.4;
        q.setFromEuler(e.set(rng.next() * 3, rng.next() * 6, rng.next() * 3));
        m.compose(p.set(x, 0.03 * s, z), q, sc.set(s, s * 0.6, s * (0.7 + rng.next() * 0.6)));
        stones.setMatrixAt(si++, m);
      } else if (pi < patches.count) {
        const r = 0.8 + rng.next() * 2.4;
        q.setFromEuler(e.set(0, rng.next() * 6, 0));
        m.compose(p.set(x, 0.012, z), q, sc.set(r, 1, r * (0.6 + rng.next() * 0.5)));
        patches.setMatrixAt(pi++, m);
      }
    }
    stones.count = si;
    patches.count = pi;
    stones.instanceMatrix.needsUpdate = true;
    patches.instanceMatrix.needsUpdate = true;
    stones.receiveShadow = true;
    freezeStatic(stones);
    freezeStatic(patches);
    scene.add(stones, patches);
    disposers.push(() => {
      scene.remove(stones, patches);
      stoneGeo.dispose();
      stoneMat.dispose();
      stains.dispose();
      stainMat.dispose();
      stones.dispose();
      patches.dispose();
    });
  }

  // --- floating motes --------------------------------------------------------------------------------------------
  const moteCount = profile.ambientCount;
  const SPAN = 36;
  const HEIGHT = 12;
  const pos = new Float32Array(moteCount * 3);
  const seeds = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount * 3; i++) seeds[i] = rng.next();
  const moteGeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  moteGeo.setAttribute('position', posAttr);
  const dot = makeSoftDotTexture(0, 32);
  const moteMat = new THREE.PointsMaterial({
    color: preset.mote.colour,
    size: preset.mote.size * (profile.glow ? 1 : 1.4),
    map: dot,
    transparent: true,
    opacity: preset.mote.opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  scene.add(motes);
  let clock = 0;
  disposers.push(() => {
    scene.remove(motes);
    moteGeo.dispose();
    moteMat.dispose();
    dot?.dispose();
  });

  const wrap = (v: number, c: number, span: number): number =>
    ((((v - c + span / 2) % span) + span) % span) - span / 2 + c;

  return {
    update(dt, px, py, pz) {
      clock += dt;
      sky.position.set(px, py, pz);
      skyUniforms.time.value = clock;
      const rise = preset.mote.rise;
      for (let i = 0; i < moteCount; i++) {
        const sx = seeds[i * 3] ?? 0;
        const sy = seeds[i * 3 + 1] ?? 0;
        const sz = seeds[i * 3 + 2] ?? 0;
        // Each mote wraps inside a box that follows the player, and wanders on slow sines.
        const bx = sx * SPAN - SPAN / 2 + Math.sin(clock * 0.3 + sz * 9) * 1.2 + clock * 0.25;
        const by = (((sy * HEIGHT + clock * rise) % HEIGHT) + HEIGHT) % HEIGHT;
        const bz = sz * SPAN - SPAN / 2 + Math.cos(clock * 0.27 + sx * 9) * 1.2;
        pos[i * 3] = wrap(bx, px, SPAN);
        pos[i * 3 + 1] = by + 0.2;
        pos[i * 3 + 2] = wrap(bz, pz, SPAN);
      }
      posAttr.needsUpdate = true;
    },
    dispose() {
      for (const d of disposers) d();
      disposers.length = 0;
    },
  };
}
