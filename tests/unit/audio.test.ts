import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AudioGraph,
  audioSupported,
  noise,
  tone,
  playEvent,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type AudioBufferSourceLike,
  type BiquadFilterLike,
  type GainNodeLike,
  type OscillatorLike,
  type SoundEvent,
} from '../../src/audio';

class FakeParam implements AudioParamLike {
  value = 1;
  readonly events: Array<{ kind: 'set' | 'ramp'; value: number; time: number }> = [];
  setValueAtTime(value: number, time: number): void {
    this.events.push({ kind: 'set', value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number): void {
    this.events.push({ kind: 'ramp', value, time });
  }
}

class FakeNode implements AudioNodeLike {
  readonly outputs: AudioNodeLike[] = [];
  constructor(private readonly owner: FakeContext) {}
  connect(destination: AudioNodeLike): AudioNodeLike {
    this.outputs.push(destination);
    this.owner.connections.push([this, destination]);
    return destination;
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam();
}

class FakeFilter extends FakeNode implements BiquadFilterLike {
  type = 'allpass';
  readonly frequency = new FakeParam();
}

class FakeSource extends FakeNode implements AudioBufferSourceLike {
  buffer: AudioBufferLike | null = null;
  started: number | null = null;
  stopped: number | null = null;
  start(when?: number): void {
    this.started = when ?? 0;
  }
  stop(when?: number): void {
    this.stopped = when ?? 0;
  }
}

class FakeOscillator extends FakeNode implements OscillatorLike {
  readonly frequency = new FakeParam();
  started: number | null = null;
  stopped: number | null = null;
  start(when?: number): void {
    this.started = when ?? 0;
  }
  stop(when?: number): void {
    this.stopped = when ?? 0;
  }
}

class FakeBuffer implements AudioBufferLike {
  readonly data: Float32Array;
  constructor(
    readonly channels: number,
    length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeContext implements AudioContextLike {
  currentTime = 2;
  readonly sampleRate = 8000;
  state = 'running';
  readonly connections: Array<[FakeNode, AudioNodeLike]> = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly sources: FakeSource[] = [];
  readonly oscillators: FakeOscillator[] = [];
  readonly compressors: FakeNode[] = [];
  readonly buffers: FakeBuffer[] = [];
  readonly destination = new FakeNode(this);
  resumeImpl: () => Promise<void> = () => Promise.resolve();
  resumeCalls = 0;

  createGain(): GainNodeLike {
    const g = new FakeGain(this);
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): BiquadFilterLike {
    const f = new FakeFilter(this);
    this.filters.push(f);
    return f;
  }
  createBufferSource(): AudioBufferSourceLike {
    const s = new FakeSource(this);
    this.sources.push(s);
    return s;
  }
  createOscillator(): OscillatorLike {
    const o = new FakeOscillator(this);
    this.oscillators.push(o);
    return o;
  }
  createDynamicsCompressor(): AudioNodeLike {
    const c = new FakeNode(this);
    this.compressors.push(c);
    return c;
  }
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
    const b = new FakeBuffer(channels, length, sampleRate);
    this.buffers.push(b);
    return b;
  }
  async resume(): Promise<void> {
    this.resumeCalls++;
    await this.resumeImpl();
  }
}

function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error('no item at index ' + String(index));
  return item;
}

function makeGraph(ctx: FakeContext = new FakeContext()): { ctx: FakeContext; graph: AudioGraph } {
  const graph = AudioGraph.create(() => ctx);
  if (!graph) throw new Error('graph was not created');
  return { ctx, graph };
}

// The master gain is the gain node that feeds the limiter.
function masterOf(ctx: FakeContext): FakeGain {
  const limiter = nth(ctx.compressors, 0);
  const master = ctx.gains.find((g) => g.outputs.includes(limiter));
  if (!master) throw new Error('master gain not found');
  return master;
}

// The most recently created gain, i.e. the per-sound envelope gain.
function lastGain(ctx: FakeContext): FakeGain {
  const gain = ctx.gains[ctx.gains.length - 1];
  if (!gain) throw new Error('no gain created');
  return gain;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AudioGraph buses and volume', () => {
  it('starts master at the legacy default of 0.8', () => {
    const { ctx } = makeGraph();
    expect(masterOf(ctx).gain.value).toBe(0.8);
  });

  it('master gain follows setMasterVolume and clamps to 0..1', () => {
    const { ctx, graph } = makeGraph();
    graph.setMasterVolume(0.35);
    expect(masterOf(ctx).gain.value).toBe(0.35);
    graph.setMasterVolume(2);
    expect(masterOf(ctx).gain.value).toBe(1);
    graph.setMasterVolume(-1);
    expect(masterOf(ctx).gain.value).toBe(0);
  });

  it('setMuted(true) sets master gain to 0 and setMuted(false) restores the stored volume', () => {
    const { ctx, graph } = makeGraph();
    graph.setMasterVolume(0.5);
    graph.setMuted(true);
    expect(masterOf(ctx).gain.value).toBe(0);
    graph.setMuted(false);
    expect(masterOf(ctx).gain.value).toBe(0.5);
  });

  it('a volume change while muted is kept for when sound returns', () => {
    const { ctx, graph } = makeGraph();
    graph.setMuted(true);
    graph.setMasterVolume(0.6);
    expect(masterOf(ctx).gain.value).toBe(0);
    graph.setMuted(false);
    expect(masterOf(ctx).gain.value).toBe(0.6);
  });

  it('each bus feeds master and setBusVolume changes only that bus', () => {
    const { ctx, graph } = makeGraph();
    const master = masterOf(ctx);
    for (const name of ['sfx', 'ui', 'ambience'] as const) {
      expect(graph.input(name)).toBeDefined();
      expect((graph.input(name) as FakeNode).outputs).toContain(master);
    }
    graph.setBusVolume('ui', 0.3);
    expect((graph.input('ui') as FakeGain).gain.value).toBe(0.3);
    expect((graph.input('sfx') as FakeGain).gain.value).toBe(1);
    expect(master.gain.value).toBe(0.8);
  });

  it('routes master -> limiter -> destination, with the limiter connected before the destination', () => {
    const { ctx } = makeGraph();
    const limiter = nth(ctx.compressors, 0);
    const masterToLimiter = ctx.connections.findIndex(
      ([from, to]) => from === masterOf(ctx) && to === limiter,
    );
    const limiterToDestination = ctx.connections.findIndex(
      ([from, to]) => from === limiter && to === ctx.destination,
    );
    expect(masterToLimiter).toBeGreaterThanOrEqual(0);
    expect(limiterToDestination).toBeGreaterThan(masterToLimiter);
    const busDirect = ctx.connections.filter(([, to]) => to === ctx.destination);
    expect(busDirect).toHaveLength(1);
  });

  it('exposes the state and resume() of the context', async () => {
    const { ctx, graph } = makeGraph();
    expect(graph.state).toBe('running');
    ctx.state = 'suspended';
    expect(graph.state).toBe('suspended');
    await graph.resume();
    expect(ctx.resumeCalls).toBe(1);
  });

  it('resume() resolves even when the context refuses to resume', async () => {
    const ctx = new FakeContext();
    ctx.resumeImpl = () => Promise.reject(new Error('blocked'));
    const { graph } = makeGraph(ctx);
    await expect(graph.resume()).resolves.toBeUndefined();
  });

  it('builds one second of seeded white noise, identical across graphs', () => {
    const a = makeGraph();
    const b = makeGraph();
    expect(a.graph.noiseBuffer).toBe(nth(a.ctx.buffers, 0));
    const bufA = nth(a.ctx.buffers, 0);
    expect(bufA.channels).toBe(1);
    expect(bufA.sampleRate).toBe(8000);
    expect(bufA.data.length).toBe(8000);
    expect(Array.from(bufA.data.slice(0, 64))).toEqual(Array.from(nth(b.ctx.buffers, 0).data.slice(0, 64)));
    expect(Array.from(bufA.data).every((v) => v >= -1 && v < 1)).toBe(true);
  });
});

describe('AudioGraph.create', () => {
  it('returns null when the factory throws', () => {
    expect(
      AudioGraph.create(() => {
        throw new Error('no audio device');
      }),
    ).toBeNull();
  });

  it('returns null when the factory returns null', () => {
    expect(AudioGraph.create(() => null)).toBeNull();
  });

  it('returns null when the default factory has no Web Audio (node test environment)', () => {
    expect(audioSupported()).toBe(false);
    expect(AudioGraph.create()).toBeNull();
  });

  it('the default factory uses the global AudioContext when present', () => {
    const ctx = new FakeContext();
    vi.stubGlobal('AudioContext', function FakeAudioContext() {
      return ctx;
    });
    expect(audioSupported()).toBe(true);
    const graph = AudioGraph.create();
    expect(graph).not.toBeNull();
    expect(graph?.context).toBe(ctx);
  });
});

describe('noise and tone recipes', () => {
  it('noise() uses a buffer source with the given lowpass frequency and stops after dur', () => {
    const { ctx, graph } = makeGraph();
    noise(graph, 'sfx', 0.5, 1800, 0.12);
    const src = nth(ctx.sources, 0);
    const filter = nth(ctx.filters, 0);
    expect(src.buffer).toBe(graph.noiseBuffer);
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBe(1800);
    expect(src.started).toBe(2);
    expect(src.stopped).toBe(2.5);
    expect(src.outputs).toContain(filter);
    expect(filter.outputs).toHaveLength(1);
  });

  it('noise() decays its gain from vol to 0.001 over dur', () => {
    const { ctx, graph } = makeGraph();
    noise(graph, 'sfx', 0.5, 1800, 0.12);
    const gain = lastGain(ctx);
    expect(gain.gain.events).toEqual([
      { kind: 'set', value: 0.12, time: 2 },
      { kind: 'ramp', value: 0.001, time: 2.5 },
    ]);
  });

  it('noise() routes to the requested bus', () => {
    const { ctx, graph } = makeGraph();
    noise(graph, 'ambience', 0.2, 900, 0.2);
    const gain = lastGain(ctx);
    expect(gain.outputs).toEqual([graph.input('ambience')]);
  });

  it('tone() uses the given frequency and stops after dur', () => {
    const { ctx, graph } = makeGraph();
    tone(graph, 'ui', 1400, 0.15, 0.2);
    const osc = nth(ctx.oscillators, 0);
    expect(osc.frequency.value).toBe(1400);
    expect(osc.started).toBe(2);
    expect(osc.stopped).toBeCloseTo(2.15, 10);
  });
});

describe('playEvent', () => {
  it('a suppressed gunfire event uses the 1800 Hz lowpass recipe', () => {
    const { ctx, graph } = makeGraph();
    playEvent(graph, { type: 'gunfire', weapon: 'vx', suppressed: true });
    expect(ctx.filters).toHaveLength(1);
    expect(nth(ctx.filters, 0).frequency.value).toBe(1800);
    expect(nth(ctx.sources, 0).stopped).toBeCloseTo(2.05, 10);
    const gain = lastGain(ctx);
    expect(gain.gain.events[0]).toEqual({ kind: 'set', value: 0.12, time: 2 });
    expect(gain.outputs).toEqual([graph.input('sfx')]);
  });

  it('an unsuppressed rifle shot uses the 2600 Hz recipe and the breaker uses 1200 Hz', () => {
    const { ctx, graph } = makeGraph();
    playEvent(graph, { type: 'gunfire', weapon: 'vx', suppressed: false });
    expect(nth(ctx.filters, 0).frequency.value).toBe(2600);

    const breaker = makeGraph();
    playEvent(breaker.graph, { type: 'gunfire', weapon: 'bk', suppressed: false });
    expect(nth(breaker.ctx.filters, 0).frequency.value).toBe(1200);
    expect(nth(breaker.ctx.sources, 0).stopped).toBeCloseTo(2.25, 10);
  });

  it('a head-shot kill plays 1400 Hz and a body kill plays 300 Hz, both on the ui bus', () => {
    const head = makeGraph();
    playEvent(head.graph, { type: 'kill', head: true });
    expect(nth(head.ctx.oscillators, 0).frequency.value).toBe(1400);
    expect(lastGain(head.ctx).outputs).toEqual([head.graph.input('ui')]);

    const body = makeGraph();
    playEvent(body.graph, { type: 'kill', head: false });
    expect(nth(body.ctx.oscillators, 0).frequency.value).toBe(300);
  });

  it('resupply and medkit pickups use their legacy tones', () => {
    const resupply = makeGraph();
    playEvent(resupply.graph, { type: 'pickup', kind: 'resupply' });
    expect(nth(resupply.ctx.oscillators, 0).frequency.value).toBe(520);

    const medkit = makeGraph();
    playEvent(medkit.graph, { type: 'pickup', kind: 'medkit' });
    expect(nth(medkit.ctx.oscillators, 0).frequency.value).toBe(640);
  });

  it('every event type plays without throwing and creates audio nodes', () => {
    const events: SoundEvent[] = [
      { type: 'gunfire', weapon: 'dm', suppressed: false },
      { type: 'enemyShot', sniper: true },
      { type: 'enemyShot', sniper: false },
      { type: 'explosion' },
      { type: 'breach' },
      { type: 'flashbang' },
      { type: 'smoke' },
      { type: 'kill', head: false },
      { type: 'pickup', kind: 'medkit' },
      { type: 'melee' },
      { type: 'sentry' },
      { type: 'friendlyRifle' },
    ];
    for (const ev of events) {
      const { ctx, graph } = makeGraph();
      playEvent(graph, ev);
      expect(ctx.sources.length + ctx.oscillators.length).toBeGreaterThan(0);
    }
  });

  it('a sniper shot uses the 900 Hz recipe and a rifle shot uses 1500 Hz', () => {
    const sniper = makeGraph();
    playEvent(sniper.graph, { type: 'enemyShot', sniper: true });
    expect(nth(sniper.ctx.filters, 0).frequency.value).toBe(900);

    const rifle = makeGraph();
    playEvent(rifle.graph, { type: 'enemyShot', sniper: false });
    expect(nth(rifle.ctx.filters, 0).frequency.value).toBe(1500);
  });
});
