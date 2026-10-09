// Held keys and newly pressed keys, by KeyboardEvent.code (legacy index.html:1280 `keys`, 2976-2985 keydown/keyup).
// Keys are tracked even outside play so that keyup always clears them; only the Space/Tab preventDefault is gated on play.
export class KeyboardInput {
  private readonly heldCodes = new Set<string>();
  private pressedQueue = new Set<string>();
  private target: EventTarget | null = null;
  private readonly isPlaying: () => boolean;

  constructor(isPlaying: () => boolean) {
    this.isPlaying = isPlaying;
  }

  attach(target: EventTarget): void {
    if (this.target !== null) this.detach();
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
  }

  detach(): void {
    if (this.target === null) return;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target = null;
  }

  // Returns the codes pressed since the last drain and empties the queue.
  drainPressed(): Set<string> {
    const drained = this.pressedQueue;
    this.pressedQueue = new Set<string>();
    return drained;
  }

  held(): ReadonlySet<string> {
    return new Set(this.heldCodes);
  }

  clear(): void {
    this.heldCodes.clear();
    this.pressedQueue.clear();
  }

  private readonly onKeyDown = (event: Event): void => {
    const e = event as KeyboardEvent;
    if ((e.code === 'Space' || e.code === 'Tab') && this.isPlaying()) e.preventDefault();
    const wasHeld = this.heldCodes.has(e.code);
    this.heldCodes.add(e.code);
    if (!e.repeat && !wasHeld) this.pressedQueue.add(e.code);
  };

  private readonly onKeyUp = (event: Event): void => {
    const e = event as KeyboardEvent;
    this.heldCodes.delete(e.code);
  };
}
