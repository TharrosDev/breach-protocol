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
