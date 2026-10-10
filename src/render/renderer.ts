import * as THREE from 'three';

// WebGL renderer with the look shared by the whole game: ACES tone mapping, sRGB output, soft shadows.
// - powerPreference asks for the discrete GPU on a hybrid laptop.
// - No stencil buffer: nothing in the game uses it, and it costs memory on every frame buffer.
// - The shadow map is redrawn on demand (see the frame loop), not on every render call.
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  return renderer;
}
