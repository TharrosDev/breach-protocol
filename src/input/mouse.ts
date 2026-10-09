// Fire and ADS held flags, and raw look deltas (legacy index.html:2999-3019).
// Mouse buttons and look only count while playing, as in legacy. Contextmenu is always prevented.
export class MouseInput {
  private fireHeld = false;
  private adsHeld = false;
  private lookX = 0;
  private lookY = 0;
  private canvas: HTMLElement | null = null;
  private win: EventTarget | null = null;
  private readonly isPlaying: () => boolean;

  constructor(isPlaying: () => boolean) {
    this.isPlaying = isPlaying;
  }

  // `canvas` receives mousedown. `win` receives mouseup, contextmenu and mousemove, so a release outside the canvas still clears the flags.
  attach(canvas: HTMLElement, win: EventTarget = window): void {
    if (this.canvas !== null) this.detach();
    this.canvas = canvas;
    this.win = win;
    canvas.addEventListener('mousedown', this.onMouseDown);
    win.addEventListener('mouseup', this.onMouseUp);
    win.addEventListener('contextmenu', this.onContextMenu);
    win.addEventListener('mousemove', this.onMouseMove);
  }

  detach(): void {
    if (this.canvas !== null) this.canvas.removeEventListener('mousedown', this.onMouseDown);
    if (this.win !== null) {
      this.win.removeEventListener('mouseup', this.onMouseUp);
      this.win.removeEventListener('contextmenu', this.onContextMenu);
      this.win.removeEventListener('mousemove', this.onMouseMove);
    }
    this.canvas = null;
    this.win = null;
  }

  buttons(): { fire: boolean; ads: boolean } {
    return { fire: this.fireHeld, ads: this.adsHeld };
  }

  // Returns the look deltas accumulated since the last drain, and resets them.
  drainLook(): { dx: number; dy: number } {
    const look = { dx: this.lookX, dy: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return look;
  }

  clear(): void {
    this.fireHeld = false;
    this.adsHeld = false;
  }

  private readonly onMouseDown = (event: Event): void => {
    if (!this.isPlaying()) return;
    const e = event as MouseEvent;
    if (e.button === 0) this.fireHeld = true;
    if (e.button === 2) this.adsHeld = true;
  };

  private readonly onMouseUp = (event: Event): void => {
    const e = event as MouseEvent;
    if (e.button === 0) this.fireHeld = false;
    if (e.button === 2) this.adsHeld = false;
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onMouseMove = (event: Event): void => {
    if (!this.isPlaying()) return;
    const e = event as MouseEvent;
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  };
}
