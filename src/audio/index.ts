export { AudioGraph, defaultAudioContextFactory } from './graph';
export type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  AudioBufferLike,
  AudioBufferSourceLike,
  BiquadFilterLike,
  BusName,
  GainNodeLike,
  OscillatorLike,
} from './graph';
export { noise, tone, toneAt, SFX } from './synth';
export { playEvent } from './events';
export type { SoundEvent } from './events';

// True when the browser exposes a Web Audio constructor. Does not create a context.
export function audioSupported(): boolean {
  const g = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown };
  return typeof g.AudioContext === 'function' || typeof g.webkitAudioContext === 'function';
}
