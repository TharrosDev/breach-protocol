import * as THREE from 'three';

export interface PostChain {
  render(): void;
  setSize(w: number, h: number, pixelRatio: number): void;
  dispose(): void;
}

// Example modules are loaded with dynamic imports so a failed fetch leaves the game running without post.
// Legacy index.html:430-433 does the same. All modules load together, so one failure disables the whole set.
async function importModules() {
  const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { RoomEnvironment }] =
    await Promise.all([
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js'),
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      import('three/examples/jsm/postprocessing/OutputPass.js'),
      import('three/examples/jsm/environments/RoomEnvironment.js'),
    ]);
  return { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, RoomEnvironment };
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
  const output = new mods.OutputPass();
  composer.addPass(output);

  return {
    render: () => {
      composer.render();
    },
    setSize: (w, h, pixelRatio) => {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
    },
    dispose: () => {
      composer.dispose();
      bloom.dispose();
      output.dispose();
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
