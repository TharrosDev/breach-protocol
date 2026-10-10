import * as THREE from 'three';

// Screen-space state for the grade pass. All values are 0..1.
export interface PostFx {
  // Recent damage: red edge pulse and a little chromatic split.
  damage: number;
  // Low health: desaturate and a slow heartbeat vignette.
  low: number;
  // Flashbang whiteout.
  flash: number;
  // Sprint: a faint radial blur-like edge darkening.
  sprint: number;
  // Seconds, for the heartbeat.
  time: number;
}

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    damage: { value: 0 },
    low: { value: 0 },
    flash: { value: 0 },
    sprint: { value: 0 },
    time: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float damage; uniform float low; uniform float flash; uniform float sprint; uniform float time;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float r = dot(c, c);
      float split = (damage * 0.012 + sprint * 0.003) * r * 4.0;
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 col = vec3(texture2D(tDiffuse, vUv + c * split).r, base.g, texture2D(tDiffuse, vUv - c * split).b);
      float beat = low * (0.5 + 0.5 * sin(time * 6.5)) * (0.5 + 0.5 * sin(time * 3.25));
      float vig = smoothstep(0.12, 0.62, r) * (0.28 + sprint * 0.2 + low * 0.35 + beat * 0.25);
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(luma), low * 0.55);
      col = mix(col, col * vec3(1.0, 0.55, 0.5), min(1.0, vig * (damage + low) * 1.3));
      col *= 1.0 - vig;
      col += vec3(1.0, 0.18, 0.14) * damage * smoothstep(0.1, 0.55, r) * 0.35;
      col = mix(col, vec3(1.0), flash);
      gl_FragColor = vec4(col, base.a);
    }`,
};

export interface PostChain {
  render(): void;
  setFx(fx: PostFx): void;
  setSize(w: number, h: number, pixelRatio: number): void;
  dispose(): void;
}

// Example modules are loaded with dynamic imports so a failed fetch leaves the game running without post.
// Legacy index.html:430-433 does the same. All modules load together, so one failure disables the whole set.
async function importModules() {
  const [
    { EffectComposer },
    { RenderPass },
    { UnrealBloomPass },
    { OutputPass },
    { RoomEnvironment },
    { ShaderPass },
  ] = await Promise.all([
    import('three/examples/jsm/postprocessing/EffectComposer.js'),
    import('three/examples/jsm/postprocessing/RenderPass.js'),
    import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
    import('three/examples/jsm/postprocessing/OutputPass.js'),
    import('three/examples/jsm/environments/RoomEnvironment.js'),
    import('three/examples/jsm/postprocessing/ShaderPass.js'),
  ]);
  return { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, RoomEnvironment, ShaderPass };
}

type PostModules = Awaited<ReturnType<typeof importModules>>;

let loading: Promise<PostModules | null> | null = null;

// Cached, so a failure warns once and later calls skip the network.
function loadModules(): Promise<PostModules | null> {
  loading ??= importModules().catch((err: unknown) => {
    console.warn('Post-processing modules failed to load; running without post.', err);
    return null;
  });
  return loading;
}

// Environment textures are kept per scene, so toggling quality does not regenerate PMREM.
const environments = new WeakMap<THREE.Scene, THREE.Texture>();

// Bloom 0.22 / radius 0.5 / threshold 0.92, then OutputPass (legacy index.html:3059-3071).
// Resolves null when the example modules cannot load.
export async function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Promise<PostChain | null> {
  const mods = await loadModules();
  if (mods === null) return null;

  const size = renderer.getSize(new THREE.Vector2());
  const composer = new mods.EffectComposer(renderer);
  composer.addPass(new mods.RenderPass(scene, camera));
  const bloom = new mods.UnrealBloomPass(size, 0.22, 0.5, 0.92);
  composer.addPass(bloom);
  const grade = new mods.ShaderPass(GRADE_SHADER);
  composer.addPass(grade);
  const output = new mods.OutputPass();
  composer.addPass(output);

  return {
    render: () => {
      composer.render();
    },
    setFx: (fx) => {
      const u = grade.uniforms as typeof GRADE_SHADER.uniforms;
      u.damage.value = fx.damage;
      u.low.value = fx.low;
      u.flash.value = fx.flash;
      u.sprint.value = fx.sprint;
      u.time.value = fx.time;
    },
    setSize: (w, h, pixelRatio) => {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
    },
    dispose: () => {
      composer.dispose();
      bloom.dispose();
      output.dispose();
      grade.dispose();
    },
  };
}

// Sets scene.environment to a RoomEnvironment PMREM texture (legacy index.html:3064).
// Async because the example module is loaded dynamically. If it fails to load, the scene keeps its current environment.
export async function applyEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Promise<void> {
  const mods = await loadModules();
  if (mods === null) return;

  let texture = environments.get(scene);
  if (texture === undefined) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    try {
      texture = pmrem.fromScene(new mods.RoomEnvironment(), 0.04).texture;
    } finally {
      pmrem.dispose();
    }
    environments.set(scene, texture);
  }
  scene.environment = texture;
}
