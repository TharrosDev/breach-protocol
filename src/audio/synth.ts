import type { AudioGraph, BusName } from './graph';

// Procedural sound only: no assets. Recipes mirror the legacy noise() and tone()
// helpers (public/index.html:1328-1346) and their call sites.

// Filtered white noise with an exponential decay. Legacy noise(dur, freq, vol).
export function noise(graph: AudioGraph, bus: BusName, dur: number, freq: number, vol: number): void {
  const ctx = graph.context;
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = graph.noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(graph.input(bus));
  src.start(now);
  src.stop(now + dur);
}

// Sine tone with an exponential decay. Legacy tone(freq, dur, vol).
export function tone(graph: AudioGraph, bus: BusName, freq: number, dur: number, vol: number): void {
  const ctx = graph.context;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(gain);
  gain.connect(graph.input(bus));
  osc.start(now);
  osc.stop(now + dur);
}

// Named recipes. Each argument list is copied from the legacy call site named in its comment.
export const SFX = {
  // Rifle, SMG, LMG and DMR fire. Legacy fire(), index.html:1832.
  gunfire(graph: AudioGraph): void {
    noise(graph, 'sfx', 0.12, 2600, 0.35);
  },

  // Breaker shotgun fire (weapon id 'bk'). Legacy fire(), index.html:1832.
  gunfireBreaker(graph: AudioGraph): void {
    noise(graph, 'sfx', 0.25, 1200, 0.6);
  },

  // Any weapon with a suppressor (w.noisy false). Legacy fire(), index.html:1835.
  gunfireSuppressed(graph: AudioGraph): void {
    noise(graph, 'sfx', 0.05, 1800, 0.12);
  },

  // Hostile fire. enemyShoot() at index.html:2242 (sniper branch, else branch).
  enemyShot(graph: AudioGraph, sniper: boolean): void {
    if (sniper) noise(graph, 'sfx', 0.2, 900, 0.2);
    else noise(graph, 'sfx', 0.08, 1500, 0.08);
  },

  // Blast. explodeAt() at index.html:1607 (airstrike shells, player frag), and enemy frag at 1973.
  explosion(graph: AudioGraph): void {
    noise(graph, 'sfx', 0.8, 400, 1.0);
  },

  // Breach charge detonation. updPlant() at index.html:2081.
  breach(graph: AudioGraph): void {
    noise(graph, 'sfx', 0.9, 350, 1.0);
  },

  // Flashbang detonation. explodeGrenade() at index.html:1989.
  flashbang(graph: AudioGraph): void {
    noise(graph, 'sfx', 0.45, 5000, 0.9);
  },

  // Smoke grenade. explodeGrenade() at index.html:1968.
  smoke(graph: AudioGraph): void {
    noise(graph, 'sfx', 0.5, 800, 0.4);
  },

  // Enemy killed: 1400 Hz on a head shot, else 300 Hz. damageEnemy() at index.html:2531.
  // Routed to the ui bus as hit and kill feedback.
  kill(graph: AudioGraph, head: boolean): void {
    tone(graph, 'ui', head ? 1400 : 300, 0.15, 0.2);
  },

  // Crate resupply. resupply() at index.html:3232. Routed to the ui bus as pickup feedback.
  pickupResupply(graph: AudioGraph): void {
    tone(graph, 'ui', 520, 0.12, 0.15);
  },

  // Medkit used. useMedkit() at index.html:2007. Routed to the ui bus as pickup feedback.
  pickupMedkit(graph: AudioGraph): void {
    tone(graph, 'ui', 640, 0.15, 0.2);
  },

  // Knife swing. melee() at index.html:3247.
  melee(graph: AudioGraph): void {
    tone(graph, 'sfx', 180, 0.08, 0.15);
  },

  // Sentry turret shot. updTurrets() at index.html:1582.
  sentry(graph: AudioGraph): void {
    noise(graph, 'sfx', 0.06, 2000, 0.07);
  },

  // Friendly operator rifle. allyFire() at index.html:2437.
  friendlyRifle(graph: AudioGraph): void {
    noise(graph, 'sfx', 0.06, 2000, 0.08);
  },
};
