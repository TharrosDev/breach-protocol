import { describe, it, expect } from 'vitest';
import type { Action } from '../../src/content/ids';
import { DIFF } from '../../src/content/difficulty';
import { WEAPONS } from '../../src/content/weapons';
import type { Enemy } from '../../src/sim/entities';
import { createRng } from '../../src/core/rng';
import { CollisionWorld } from '../../src/sim/collision';
import type { Command } from '../../src/input/commands';
import { SimWorld, type SimEvent, type SimOptions } from '../../src/sim/world';
import { mapSimEventToSound } from '../../src/app/sound-map';
import { AppSound } from '../../src/app/sound';
import {
  AudioGraph,
  type AudioBufferLike,
  type AudioBufferSourceLike,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type BiquadFilterLike,
  type GainNodeLike,
  type OscillatorLike,
} from '../../src/audio';

// Sim events to sound (app/sound-map.ts), and the page sound wrapper (app/sound.ts). The sim part runs the real
// SimWorld, so a missing event shows up here, not only in the E2E run.

const DT = 1 / 60;

const IDLE: Command = {
  move: { fwd: 0, strafe: 0 },
  look: { dx: 0, dy: 0 },
  buttons: { fire: false, ads: false },
  pressed: new Set<Action>(),
  crouch: false,
  sprint: false,
};

type SimOpts = SimOptions;

function baseOptions(over: Partial<SimOpts> = {}): SimOpts {
  return {
    collision: new CollisionWorld(),
    // One zone far from the fight, so the match does not end at once (see world.test.ts).
    zones: [{ name: 'Far', x: 500, z: 500 }],
    spawns: [{ x: 0, z: 40 }],
    buildings: [],
    rng: createRng(1),
    difficulty: DIFF.veteran,
    weapon: WEAPONS.vx,
    attachment: 'reflex',
    perk: 'steady',
    adsRate: 17,
    playerSpawn: { x: 0, y: 0, z: 0 },
    playerYaw: 0,
    gadgets: ['frag', 'smoke'],
    crates: [],
    mapName: 'Test',
    ...over,
  };
}

// Steps the sim for `seconds`, pressing `pressed` on the first tick only, and returns every event.
function run(sim: SimWorld, seconds: number, pressed: Action[] = [], fireClick = false): SimEvent[] {
  const events: SimEvent[] = [];
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    const cmd: Command = i === 0 ? { ...IDLE, pressed: new Set(pressed) } : IDLE;
    events.push(...sim.step(cmd, DT, i === 0 && fireClick));
  }
  return events;
}

// Only the enemy kind is read by the mapping.
function shooterOf(kind: 'rifle' | 'sniper'): Enemy {
  return { kind } as Enemy;
}

describe('mapSimEventToSound', () => {
  it('a player shot plays gunfire with its weapon id and suppression', () => {
    expect(mapSimEventToSound({ type: 'playerFire', weapon: 'vx', suppressed: false })).toEqual({
      type: 'gunfire',
      weapon: 'vx',
      suppressed: false,
    });
    expect(mapSimEventToSound({ type: 'playerFire', weapon: 'vx', suppressed: true })).toEqual({
      type: 'gunfire',
      weapon: 'vx',
      suppressed: true,
    });
  });

  it('hostile shots choose the sniper tone from the shooter kind', () => {
    const sniper = mapSimEventToSound({
      type: 'enemyShot',
      shooter: shooterOf('sniper'),
      from: { x: 0, y: 1, z: 0 },
      to: { x: 0, y: 1, z: 10 },
      tracer: true,
      hit: false,
    });
    const rifle = mapSimEventToSound({
      type: 'enemyShot',
      shooter: shooterOf('rifle'),
      from: { x: 0, y: 1, z: 0 },
      to: { x: 0, y: 1, z: 10 },
      tracer: false,
      hit: false,
    });
    expect(sniper).toEqual({ type: 'enemyShot', sniper: true });
    expect(rifle).toEqual({ type: 'enemyShot', sniper: false });
  });

  it('friendly rifle and sentry shots, and every kill, have their own sounds', () => {
    expect(
      mapSimEventToSound({
        type: 'operatorShot',
        operator: {} as never,
        from: { x: 0, y: 1, z: 0 },
        to: { x: 0, y: 1, z: 10 },
        enemy: null,
        head: false,
      }),
    ).toEqual({ type: 'friendlyRifle' });
    expect(
      mapSimEventToSound({
        type: 'turretShot',
        from: { x: 0, y: 1, z: 0 },
        to: { x: 0, y: 1, z: 5 },
        hit: false,
      }),
    ).toEqual({
      type: 'sentry',
    });
    expect(
      mapSimEventToSound({
        type: 'enemyKilled',
        enemy: shooterOf('rifle'),
        by: 'player',
        head: true,
        source: 'vx',
      }),
    ).toEqual({ type: 'kill', head: true });
    expect(
      mapSimEventToSound({
        type: 'enemyKilled',
        enemy: shooterOf('rifle'),
        by: 'operator',
        head: false,
        source: 'squad',
      }),
    ).toEqual({ type: 'kill', head: false });
  });

  it('frag, airstrike and enemy frag blasts are explosions; a breach is a breach', () => {
    const at = { x: 0, y: 0, z: 0 };
    expect(mapSimEventToSound({ type: 'grenadeBlast', at, radius: 7 })).toEqual({ type: 'explosion' });
    expect(mapSimEventToSound({ type: 'airstrikeBlast', at, radius: 9 })).toEqual({ type: 'explosion' });
    expect(mapSimEventToSound({ type: 'breachBlast', at, radius: 6, box: 'wall-1' as never })).toEqual({
      type: 'breach',
    });
  });

  it('flashbang and smoke detonations have their own sounds', () => {
    const at = { x: 0, y: 0, z: 0 };
    expect(mapSimEventToSound({ type: 'grenadeDetonated', kind: 'flash', at })).toEqual({
      type: 'flashbang',
    });
    expect(mapSimEventToSound({ type: 'grenadeDetonated', kind: 'smoke', at })).toEqual({ type: 'smoke' });
  });

  it('resupply and medkit pickups map to their pickup kinds', () => {
    expect(mapSimEventToSound({ type: 'resupplied' })).toEqual({ type: 'pickup', kind: 'resupply' });
    expect(mapSimEventToSound({ type: 'medkitUsed', healed: 50 })).toEqual({
      type: 'pickup',
      kind: 'medkit',
    });
  });

  it('a knife swing plays the melee sound, hit or miss', () => {
    expect(mapSimEventToSound({ type: 'melee', hits: 0 })).toEqual({ type: 'melee' });
    expect(mapSimEventToSound({ type: 'melee', hits: 2 })).toEqual({ type: 'melee' });
  });

  it('events with no sound of their own map to null', () => {
    const silent: SimEvent[] = [
      {
        type: 'bullet',
        from: { x: 0, y: 0, z: 0 },
        to: { x: 0, y: 0, z: 1 },
        tracer: false,
        wall: true,
        enemy: null,
        head: false,
        damage: 0,
      },
      { type: 'playerHit', from: { x: 0, z: 1 }, damage: 5 },
      { type: 'playerFlashed', seconds: 3 },
      { type: 'playerDown' },
      { type: 'playerEliminated' },
      { type: 'playerRespawn' },
      { type: 'wave', wave: 1, spawned: 4 },
      { type: 'orderChanged', order: 1 },
      { type: 'sentryNoGround' },
      { type: 'killstreakUsed', id: 'uav' as never },
    ];
    for (const ev of silent) expect(mapSimEventToSound(ev)).toBeNull();
  });
});

// The sim must report the events the sounds need, so these run the real SimWorld.
describe('SimWorld events for sounds', () => {
  it('a rifle shot reports playerFire with the weapon, not suppressed', () => {
    const sim = new SimWorld(baseOptions());
    const events = run(sim, DT, [], true);
    const fire = events.find((ev) => ev.type === 'playerFire');
    expect(fire).toEqual({ type: 'playerFire', weapon: 'vx', suppressed: false });
  });

  it('a suppressed weapon reports playerFire as suppressed', () => {
    const sim = new SimWorld(baseOptions({ attachment: 'suppressor' }));
    const events = run(sim, DT, [], true);
    expect(events.find((ev) => ev.type === 'playerFire')).toEqual({
      type: 'playerFire',
      weapon: 'vx',
      suppressed: true,
    });
  });

  it('the breaker reports its own weapon id', () => {
    const sim = new SimWorld(baseOptions({ weapon: WEAPONS.bk }));
    const events = run(sim, DT, [], true);
    expect(events.find((ev) => ev.type === 'playerFire')).toEqual({
      type: 'playerFire',
      weapon: 'bk',
      suppressed: false,
    });
  });

  it('a medkit that heals reports medkitUsed, and one at full health reports nothing', () => {
    const hurt = new SimWorld(baseOptions({ gadgets: ['medkit', 'smoke'] }));
    hurt.player.hp = 50;
    const healed = run(hurt, DT, ['gadget1']).find((ev) => ev.type === 'medkitUsed');
    expect(healed).toEqual({ type: 'medkitUsed', healed: 50 });

    const full = new SimWorld(baseOptions({ gadgets: ['medkit', 'smoke'] }));
    expect(run(full, DT, ['gadget1']).some((ev) => ev.type === 'medkitUsed')).toBe(false);
  });

  it('a flashbang reports grenadeDetonated (flash) when it goes off', () => {
    const sim = new SimWorld(baseOptions({ gadgets: ['flash', 'smoke'] }));
    const det = run(sim, 2, ['gadget1']).find((ev) => ev.type === 'grenadeDetonated');
    expect(det).toMatchObject({ type: 'grenadeDetonated', kind: 'flash' });
  });

  it('a smoke grenade reports grenadeDetonated (smoke) when it goes off', () => {
    const sim = new SimWorld(baseOptions({ gadgets: ['smoke', 'flash'] }));
    const det = run(sim, 2, ['gadget1']).find((ev) => ev.type === 'grenadeDetonated');
    expect(det).toMatchObject({ type: 'grenadeDetonated', kind: 'smoke' });
  });

  it('a frag reports grenadeBlast and not grenadeDetonated', () => {
    const sim = new SimWorld(baseOptions({ gadgets: ['frag', 'smoke'] }));
    const events = run(sim, 3, ['gadget1']);
    expect(events.some((ev) => ev.type === 'grenadeBlast')).toBe(true);
    expect(events.some((ev) => ev.type === 'grenadeDetonated')).toBe(false);
  });
});

// A compact fake of the Web Audio pieces the graph uses. Records what the sound mapping creates.
class FakeNode implements AudioNodeLike {
  readonly outputs: AudioNodeLike[] = [];
  connect(destination: AudioNodeLike): AudioNodeLike {
    this.outputs.push(destination);
    return destination;
  }
}

class FakeParam implements AudioParamLike {
  value = 1;
  setValueAtTime(): void {
    // Envelope automation is not checked here.
  }
  exponentialRampToValueAtTime(): void {
    // Envelope automation is not checked here.
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
  start(): void {
    // Playback is not checked here.
  }
  stop(): void {
    // Playback is not checked here.
  }
}

class FakeOscillator extends FakeNode implements OscillatorLike {
  readonly frequency = new FakeParam();
  start(): void {
    // Playback is not checked here.
  }
  stop(): void {
    // Playback is not checked here.
  }
}

class FakeContext implements AudioContextLike {
  currentTime = 0;
  readonly sampleRate = 8000;
  // A browser context starts suspended unless it was made inside a gesture.
  state = 'suspended';
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  private compressor: FakeNode | null = null;
  sourcesMade = 0;
  oscillatorsMade = 0;
  resumes = 0;
  failSources = false;
  // When true, resume() is refused and the context stays suspended.
  stayAsleep = false;

  createGain(): GainNodeLike {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): BiquadFilterLike {
    return new FakeFilter();
  }
  createBufferSource(): AudioBufferSourceLike {
    if (this.failSources) throw new Error('no buffer sources');
    this.sourcesMade += 1;
    return new FakeSource();
  }
  createOscillator(): OscillatorLike {
    this.oscillatorsMade += 1;
    return new FakeOscillator();
  }
  createDynamicsCompressor(): AudioNodeLike {
    this.compressor = new FakeNode();
    return this.compressor;
  }
  createBuffer(_channels: number, length: number): AudioBufferLike {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  resume(): Promise<void> {
    this.resumes += 1;
    if (!this.stayAsleep) this.state = 'running';
    return Promise.resolve();
  }

  // The master gain is the gain that feeds the limiter.
  master(): FakeGain {
    const master = this.gains.find((g) => this.compressor !== null && g.outputs.includes(this.compressor));
    if (master === undefined) throw new Error('master gain not found');
    return master;
  }
}

describe('AppSound', () => {
  it('makes no graph until the first gesture, then makes it once and resumes it', () => {
    const ctx = new FakeContext();
    let made = 0;
    const sound = new AppSound({ volume: 0.5, muted: false }, () => {
      made += 1;
      return AudioGraph.create(() => ctx);
    });
    expect(made).toBe(0);
    sound.unlock();
    sound.unlock();
    expect(made).toBe(1);
    expect(ctx.resumes).toBe(1);
  });

  it('a later gesture resumes a context that is still suspended, and stops once it runs', () => {
    const ctx = new FakeContext();
    ctx.stayAsleep = true;
    const sound = new AppSound({ volume: 0.5, muted: false }, () => AudioGraph.create(() => ctx));
    sound.unlock();
    sound.unlock();
    expect(ctx.resumes).toBe(2);
    ctx.stayAsleep = false;
    sound.unlock();
    expect(ctx.resumes).toBe(3);
    expect(ctx.state).toBe('running');
    sound.unlock();
    expect(ctx.resumes).toBe(3);
  });

  it('applies the saved volume to the master gain when the graph is made', () => {
    const ctx = new FakeContext();
    const sound = new AppSound({ volume: 0.35, muted: false }, () => AudioGraph.create(() => ctx));
    sound.unlock();
    expect(ctx.master().gain.value).toBe(0.35);
  });

  it('a saved mute is applied when the graph is made', () => {
    const ctx = new FakeContext();
    const sound = new AppSound({ volume: 0.35, muted: true }, () => AudioGraph.create(() => ctx));
    sound.unlock();
    expect(ctx.master().gain.value).toBe(0);
  });

  it('setLevels moves the master gain live, and mute keeps the volume for later', () => {
    const ctx = new FakeContext();
    const sound = new AppSound({ volume: 0.8, muted: false }, () => AudioGraph.create(() => ctx));
    sound.unlock();
    sound.setLevels({ volume: 0.2, muted: false });
    expect(ctx.master().gain.value).toBe(0.2);
    sound.setLevels({ volume: 0.2, muted: true });
    expect(ctx.master().gain.value).toBe(0);
    sound.setLevels({ volume: 0.2, muted: false });
    expect(ctx.master().gain.value).toBe(0.2);
  });

  it('plays nothing before the first gesture, and plays after it', () => {
    const ctx = new FakeContext();
    const sound = new AppSound({ volume: 0.8, muted: false }, () => AudioGraph.create(() => ctx));
    sound.play({ type: 'explosion' });
    expect(ctx.sourcesMade).toBe(0);
    sound.unlock();
    sound.play({ type: 'explosion' });
    expect(ctx.sourcesMade).toBe(1);
  });

  it('stays silent and does not throw when no audio graph can be made', () => {
    const sound = new AppSound({ volume: 0.8, muted: false }, () => null);
    expect(() => {
      sound.unlock();
      sound.setLevels({ volume: 0.1, muted: true });
      sound.play({ type: 'breach' });
    }).not.toThrow();
  });

  it('a sound that fails inside the audio stack does not throw out of play()', () => {
    const ctx = new FakeContext();
    const sound = new AppSound({ volume: 0.8, muted: false }, () => AudioGraph.create(() => ctx));
    sound.unlock();
    ctx.failSources = true;
    expect(() => {
      sound.play({ type: 'gunfire', weapon: 'vx', suppressed: false });
    }).not.toThrow();
  });

  it('a kill plays a tone, not a buffer source', () => {
    const ctx = new FakeContext();
    const sound = new AppSound({ volume: 0.8, muted: false }, () => AudioGraph.create(() => ctx));
    sound.unlock();
    sound.play({ type: 'kill', head: true });
    expect(ctx.oscillatorsMade).toBe(1);
    expect(ctx.sourcesMade).toBe(0);
  });
});
