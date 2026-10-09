// Fixed-timestep accumulator. Frame time is clamped to maxFrame so a long stall (tab switch, GC pause)
// cannot trigger a spiral of catch-up steps.
export class FixedStep {
  readonly dt: number;
  // Leftover fraction of a step in [0, 1), for interpolating render state between sim steps.
  alpha = 0;

  private readonly maxFrame: number;
  private accumulator = 0;

  constructor(hz = 60, maxFrame = 0.25) {
    this.dt = 1 / hz;
    this.maxFrame = maxFrame;
  }

  // Adds the frame's elapsed time and returns how many fixed steps to run.
  advance(frameDt: number): number {
    // Negative and NaN frame times count as zero.
    const frame = frameDt > 0 ? Math.min(frameDt, this.maxFrame) : 0;
    this.accumulator += frame;

    // The epsilon absorbs float error so that 0.25 s at 60 Hz yields 15 steps, not 14.
    const steps = Math.floor(this.accumulator / this.dt + 1e-9);
    this.accumulator = Math.max(this.accumulator - steps * this.dt, 0);
    this.alpha = Math.min(this.accumulator / this.dt, 1 - Number.EPSILON);
    return steps;
  }
}
