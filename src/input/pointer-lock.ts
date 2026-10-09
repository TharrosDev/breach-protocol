// Pointer lock wrapper (legacy index.html:2671-2674 lockPointer, 3020-3028 pointerlockchange).
// request() never rejects. The app decides what an unexpected unlock means; this class only reports it.

export interface PointerLockTarget {
  requestPointerLock(): unknown;
}

export interface PointerLockDocument {
  readonly pointerLockElement: unknown;
  addEventListener(type: 'pointerlockchange', listener: () => void): void;
  removeEventListener(type: 'pointerlockchange', listener: () => void): void;
}

export class PointerLock {
  private readonly target: PointerLockTarget;
  private readonly doc: PointerLockDocument;
  private readonly listeners = new Set<(locked: boolean) => void>();
  private attached = false;

  constructor(target: PointerLockTarget, doc: PointerLockDocument) {
    this.target = target;
    this.doc = doc;
  }

  // Resolves true when the target holds the lock afterwards. A synchronous throw, a rejection, or a missing requestPointerLock all resolve false.
  async request(): Promise<boolean> {
    try {
      await this.target.requestPointerLock();
    } catch {
      return false;
    }
    return this.isLocked();
  }

  onChange(cb: (locked: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.doc.addEventListener('pointerlockchange', this.handleChange);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.doc.removeEventListener('pointerlockchange', this.handleChange);
  }

  private isLocked(): boolean {
    return this.doc.pointerLockElement === this.target;
  }

  private readonly handleChange = (): void => {
    const locked = this.isLocked();
    for (const cb of [...this.listeners]) cb(locked);
  };
}
