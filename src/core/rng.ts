export interface Rng {
  // Uniform float in [0, 1).
  next(): number;
  // Uniform float in [a, b).
  range(a: number, b: number): number;
  // Uniform element of a non-empty array.
  pick<T>(items: readonly T[]): T;
  // Child stream derived from the current state and label. The parent is not advanced.
  fork(label: string): Rng;
}

// Seeds sfc32 state from a single 32-bit seed.
function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let t = state ^ (state >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

// murmur3 finalizer: a cheap bijective 32-bit mix.
function mix32(x: number): number {
  let h = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function hashLabel(label: string): number {
  // FNV-1a over UTF-16 code units.
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  const seeder = splitmix32(seed);
  return fromWords(seeder(), seeder(), seeder(), seeder());
}

function fromWords(w0: number, w1: number, w2: number, w3: number): Rng {
  // sfc32 (PractRand-tested). State is kept as int32 and reduced with |0 and >>>.
  let a = w0 | 0;
  let b = w1 | 0;
  let c = w2 | 0;
  let d = w3 | 0;

  const nextU32 = (): number => {
    const sum = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const out = (sum + d) | 0;
    c = (c + out) | 0;
    return out >>> 0;
  };

  // Discard the first draws so that nearby seeds do not produce correlated opening values.
  for (let i = 0; i < 15; i++) nextU32();

  const next = (): number => nextU32() / 4294967296;

  return {
    next,
    range(lo: number, hi: number): number {
      return lo + (hi - lo) * next();
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new RangeError('pick() requires a non-empty array');
      }
      return items[Math.floor(next() * items.length)] as T;
    },
    fork(label: string): Rng {
      let seed = hashLabel(label);
      for (const word of [a, b, c, d]) {
        seed = mix32(seed ^ word);
      }
      return createRng(seed);
    },
  };
}
