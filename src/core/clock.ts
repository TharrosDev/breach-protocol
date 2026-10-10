// Fixed-timestep accumulator. Frame time is clamped to maxFrame so a long stall (tab switch, GC pause) cannot trigger a
// spiral of catch-up steps, and a frame never runs more than maxSteps steps: if the sim cannot keep up, the game runs
// slow for a moment instead of spending every frame catching up on the one before.
export class FixedStep {
  readonly dt: number;
  // Leftover fraction of a step in [0, 1), for interpolating render state between sim steps.
  alpha = 0;
  // Sim time dropped by the maxSteps clamp since the start, in seconds (a counter for the perf overlay).
  dropped = 0;

  private readonly maxFrame: number;
  private readonly maxSteps: number;
  private accumulator = 0;

  constructor(hz = 60, maxFrame = 0.25, maxSteps = Number.POSITIVE_INFINITY) {
    this.dt = 1 / hz;
    this.maxFrame = maxFrame;
    this.maxSteps = maxSteps;
  }

  // Adds the frame's elapsed time and returns how many fixed steps to run.
  advance(frameDt: number): number {
    // Negative and NaN frame times count as zero.
    const frame = frameDt > 0 ? Math.min(frameDt, this.maxFrame) : 0;
    this.accumulator += frame;

    // The epsilon absorbs float error so that 0.25 s at 60 Hz yields 15 steps, not 14.
    let steps = Math.floor(this.accumulator / this.dt + 1e-9);
    if (steps > this.maxSteps) steps = this.maxSteps;
    this.accumulator = Math.max(this.accumulator - steps * this.dt, 0);
    // After a clamp the leftover can still hold whole steps; drop them so the backlog cannot grow.
    const backlog = Math.floor(this.accumulator / this.dt + 1e-9);
    if (backlog > 0) {
      this.dropped += backlog * this.dt;
      this.accumulator = Math.max(this.accumulator - backlog * this.dt, 0);
    }
    this.alpha = Math.min(this.accumulator / this.dt, 1 - Number.EPSILON);
    return steps;
  }
}
