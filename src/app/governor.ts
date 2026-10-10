import type { Quality } from '../persist/schema';

export interface GovernorOptions {
  threshold: number;
  windowSeconds: number;
  sampleSeconds: number;
}

// Legacy index.html:2961-2977 (trackFps): fps below 38 for 5 s, sampled every 0.5 s.
export const DEFAULT_GOVERNOR_OPTIONS: GovernorOptions = {
  threshold: 38,
  windowSeconds: 5,
  sampleSeconds: 0.5,
};

// Tolerance so that summed sample times compare correctly for steps that are not exact binary fractions.
const EPSILON = 1e-9;

// Pure auto-downgrade timer. Call sample() once per FPS sample (every sampleSeconds).
export class FpsGovernor {
  private readonly opts: GovernorOptions;
  private slow = 0;

  constructor(opts: Partial<GovernorOptions> = {}) {
    this.opts = { ...DEFAULT_GOVERNOR_OPTIONS, ...opts };
  }

  // Only counts while playing at High, as legacy does. Outside that, the timer is left as it is.
  // Returns 'downgrade' once the slow time reaches the window, then restarts the timer.
  sample(fps: number, inPlay: boolean, quality: Quality): 'none' | 'downgrade' {
    if (!inPlay || quality !== 'high') return 'none';

    this.slow = fps < this.opts.threshold ? this.slow + this.opts.sampleSeconds : 0;
    if (this.slow >= this.opts.windowSeconds - EPSILON) {
      this.slow = 0;
      return 'downgrade';
    }
    return 'none';
  }

  reset(): void {
    this.slow = 0;
  }
}

export interface ScalerOptions {
  // Lowest and highest render scale (a fraction of the quality tier's pixel ratio).
  min: number;
  max: number;
  step: number;
  // Fraction of the target fps below which a sample counts as slow, and at or above which it counts as fast.
  slowBelow: number;
  fastAtLeast: number;
  // Consecutive slow samples before a step down. Fast samples needed before a step up (this doubles each time a
  // step up is followed by a step down, up to maxUpSamples, so the scale settles instead of flapping).
  downSamples: number;
  upSamples: number;
  maxUpSamples: number;
  // Samples to wait after any change, so the new size has time to show in the fps.
  cooldownSamples: number;
}

export const DEFAULT_SCALER_OPTIONS: ScalerOptions = {
  min: 0.6,
  max: 1,
  step: 0.1,
  slowBelow: 0.82,
  fastAtLeast: 0.97,
  downSamples: 2,
  upSamples: 8,
  maxUpSamples: 128,
  cooldownSamples: 4,
};

// Dynamic resolution. Call sample() once per FPS sample (every sampleSeconds). The scale multiplies the pixel ratio:
// below the target frame rate it steps down in 10 % steps (to 60 %), and it steps back up once the frame rate has
// held at the target for a while. Unlike FpsGovernor it never changes the quality tier, so shadows, post and lights
// stay as they are.
export class ResolutionScaler {
  private readonly opts: ScalerOptions;
  private current: number;
  private slow = 0;
  private fast = 0;
  private cooldown = 0;
  private upNeeded: number;
  private lastWasUp = false;

  constructor(opts: Partial<ScalerOptions> = {}) {
    this.opts = { ...DEFAULT_SCALER_OPTIONS, ...opts };
    this.current = this.opts.max;
    this.upNeeded = this.opts.upSamples;
  }

  get scale(): number {
    return this.current;
  }

  // targetFps is the rate the game is trying to hold: the frame cap when one is set, otherwise 60.
  // Returns the new scale when it changed, or null.
  sample(fps: number, targetFps: number, inPlay: boolean): number | null {
    if (!inPlay || !(targetFps > 0)) {
      this.slow = 0;
      this.fast = 0;
      return null;
    }
    // Samples taken while the last change settles do not count either way.
    if (this.cooldown > 0) {
      this.cooldown -= 1;
      this.slow = 0;
      this.fast = 0;
      return null;
    }
    const ratio = fps / targetFps;
    if (ratio < this.opts.slowBelow) {
      this.slow += 1;
      this.fast = 0;
    } else if (ratio >= this.opts.fastAtLeast) {
      this.fast += 1;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    if (this.slow >= this.opts.downSamples && this.current > this.opts.min + EPSILON) {
      this.current = round2(Math.max(this.opts.min, this.current - this.opts.step));
      // A drop right after a rise means the rise was too eager: wait longer next time.
      if (this.lastWasUp) this.upNeeded = Math.min(this.upNeeded * 2, this.opts.maxUpSamples);
      this.lastWasUp = false;
      return this.changed();
    }
    if (this.fast >= this.upNeeded && this.current < this.opts.max - EPSILON) {
      this.current = round2(Math.min(this.opts.max, this.current + this.opts.step));
      this.lastWasUp = true;
      return this.changed();
    }
    return null;
  }

  // Back to full scale, for example after the quality tier changes.
  reset(): void {
    this.current = this.opts.max;
    this.slow = 0;
    this.fast = 0;
    this.cooldown = 0;
    this.upNeeded = this.opts.upSamples;
    this.lastWasUp = false;
  }

  private changed(): number {
    this.slow = 0;
    this.fast = 0;
    this.cooldown = this.opts.cooldownSamples;
    return this.current;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
