import { createRng } from '../core/rng';

// Structural subset of the Web Audio API. The real AudioContext satisfies it,
// and tests pass a fake that records calls.

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface BiquadFilterLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
}

export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface OscillatorLike extends AudioNodeLike {
  readonly frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createBiquadFilter(): BiquadFilterLike;
  createBufferSource(): AudioBufferSourceLike;
  createOscillator(): OscillatorLike;
  createDynamicsCompressor(): AudioNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  resume(): Promise<void>;
}

export type BusName = 'sfx' | 'ui' | 'ambience';

const BUSES: readonly BusName[] = ['sfx', 'ui', 'ambience'];

// Legacy DEFAULT_SETTINGS.volume (index.html:565).
const DEFAULT_MASTER_VOLUME = 0.8;

// Legacy noise buffer: one second of white noise (index.html:1324-1327).
const NOISE_SECONDS = 1;
const NOISE_SEED = 1;

// Legacy audioInit (index.html:1318-1321) used `window.AudioContext || window.webkitAudioContext`.
// Only called from AudioGraph.create, never at module load.
export function defaultAudioContextFactory(): AudioContextLike | null {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

// Signal flow: source -> bus gain (sfx | ui | ambience) -> master gain -> limiter -> destination.
export class AudioGraph {
  private readonly ctx: AudioContextLike;
  private readonly masterGain: GainNodeLike;
  private readonly busGains: Record<BusName, GainNodeLike>;
  private readonly limiter: AudioNodeLike;
  private readonly noiseBuf: AudioBufferLike;
  private masterVolume = DEFAULT_MASTER_VOLUME;
  private muted = false;

  private constructor(ctx: AudioContextLike) {
    this.ctx = ctx;

    this.limiter = ctx.createDynamicsCompressor();
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;
    this.masterGain.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    const buses = {} as Record<BusName, GainNodeLike>;
    for (const name of BUSES) {
      const bus = ctx.createGain();
      bus.connect(this.masterGain);
      buses[name] = bus;
    }
    this.busGains = buses;

    const length = Math.round(ctx.sampleRate * NOISE_SECONDS);
    this.noiseBuf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    const rng = createRng(NOISE_SEED);
    for (let i = 0; i < data.length; i++) data[i] = rng.next() * 2 - 1;
  }

  // Builds the graph from a context made by `factory`. Returns null when the
  // factory or any node creation throws, so the game runs silent.
  static create(factory: () => AudioContextLike | null = defaultAudioContextFactory): AudioGraph | null {
    try {
      const ctx = factory();
      if (!ctx) return null;
      return new AudioGraph(ctx);
    } catch {
      return null;
    }
  }

  get context(): AudioContextLike {
    return this.ctx;
  }

  get state(): string {
    return this.ctx.state;
  }

  get noiseBuffer(): AudioBufferLike {
    return this.noiseBuf;
  }

  // Node a sound connects into to be heard on `bus`.
  input(bus: BusName): AudioNodeLike {
    return this.busGains[bus];
  }

  setMasterVolume(v: number): void {
    this.masterVolume = clamp01(v);
    this.applyMaster();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMaster();
  }

  setBusVolume(bus: BusName, v: number): void {
    this.busGains[bus].gain.value = clamp01(v);
  }

  // Must run inside the first user gesture. Failure leaves the graph silent.
  async resume(): Promise<void> {
    try {
      await this.ctx.resume();
    } catch {
      // Audio stays silent; gameplay never depends on it.
    }
  }

  private applyMaster(): void {
    this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
  }
}
