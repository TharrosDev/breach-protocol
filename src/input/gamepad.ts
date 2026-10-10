// Gamepad input (Gamepad API, standard mapping). The pad is turned into the same inputs the keyboard and mouse give,
// so the sim and the command builder do not know a pad exists:
//   - the left stick and the d-pad's held actions become held key codes (through the live bindings),
//   - button presses become newly pressed key codes,
//   - the right stick becomes look deltas in mouse-pixel units, scaled by time,
//   - the triggers become fire and aim.
// Everything below the class is pure and takes a plain snapshot, so it runs in the unit tests without a browser.
import type { Action } from '../content/ids';

// The part of a Gamepad this module reads. A real Gamepad satisfies it.
export interface PadSnapshot {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

// Standard-mapping button indices.
export const PAD_BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  back: 8,
  start: 9,
  l3: 10,
  r3: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;
export type PadButton = keyof typeof PAD_BUTTON;

export const STICK_DEADZONE = 0.2;
// A stick axis counts as a held direction past this deflection.
export const MOVE_THRESHOLD = 0.35;
export const TRIGGER_THRESHOLD = 0.4;
// Look speed at full deflection, in mouse pixels per second. The sensitivity setting scales it like a mouse.
export const LOOK_PIXELS_PER_SECOND = 1300;
// The response curve exponent for the look stick: above 1 gives fine control near the centre.
export const LOOK_CURVE = 1.7;

// Held actions: the pad button that holds each one. Actions on a button that is also a pressed action stay separate.
export const PAD_HELD: Readonly<Partial<Record<Action, PadButton>>> = {
  crouch: 'b',
  sprint: 'l3',
  scoreboard: 'down',
};

// Pressed (edge) actions.
export const PAD_PRESSED: Readonly<Partial<Record<Action, PadButton>>> = {
  jump: 'a',
  reload: 'x',
  gadget1: 'lb',
  gadget2: 'rb',
  melee: 'r3',
  killstreak: 'up',
  order: 'left',
  interact: 'right',
};

// Radial dead zone, rescaled so the output starts at 0 at the edge of the zone and reaches 1 at full deflection.
export function applyDeadzone(x: number, y: number, zone = STICK_DEADZONE): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (!Number.isFinite(mag) || mag <= zone) return { x: 0, y: 0 };
  const scaled = Math.min(1, (mag - zone) / (1 - zone));
  return { x: (x / mag) * scaled, y: (y / mag) * scaled };
}

// The look curve for one axis value in -1..1.
export function lookCurve(v: number): number {
  return Math.sign(v) * Math.abs(v) ** LOOK_CURVE;
}

function down(pad: PadSnapshot, button: PadButton): boolean {
  const b = pad.buttons[PAD_BUTTON[button]];
  return b !== undefined && (b.pressed || b.value > TRIGGER_THRESHOLD);
}

function trigger(pad: PadSnapshot, button: 'lt' | 'rt'): boolean {
  const b = pad.buttons[PAD_BUTTON[button]];
  return b !== undefined && (b.pressed || b.value > TRIGGER_THRESHOLD);
}

export interface PadFrame {
  // Left stick after the dead zone: x right, y forward (the raw axis is inverted).
  move: { x: number; y: number };
  // Right stick after the dead zone and the response curve: x right, y down.
  look: { x: number; y: number };
  fire: boolean;
  ads: boolean;
  buttons: ReadonlySet<PadButton>;
}

export function readPad(pad: PadSnapshot | null): PadFrame {
  if (pad === null) {
    return { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, fire: false, ads: false, buttons: new Set() };
  }
  const ls = applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
  const rs = applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
  const buttons = new Set<PadButton>();
  for (const name of Object.keys(PAD_BUTTON) as PadButton[]) {
    if (name === 'lt' || name === 'rt') continue;
    if (down(pad, name)) buttons.add(name);
  }
  return {
    move: { x: ls.x, y: -ls.y },
    look: { x: lookCurve(rs.x), y: lookCurve(rs.y) },
    fire: trigger(pad, 'rt'),
    ads: trigger(pad, 'lt'),
    buttons,
  };
}

type Lookup = { get(action: Action): string };

// Held key codes the pad produces: the stick as the four movement keys, plus the held action buttons.
export function heldCodes(frame: PadFrame, bindings: Lookup): Set<string> {
  const out = new Set<string>();
  if (frame.move.y > MOVE_THRESHOLD) out.add(bindings.get('forward'));
  if (frame.move.y < -MOVE_THRESHOLD) out.add(bindings.get('back'));
  if (frame.move.x > MOVE_THRESHOLD) out.add(bindings.get('right'));
  if (frame.move.x < -MOVE_THRESHOLD) out.add(bindings.get('left'));
  for (const [action, button] of Object.entries(PAD_HELD) as [Action, PadButton][]) {
    if (frame.buttons.has(button)) out.add(bindings.get(action));
  }
  return out;
}

// The pad as input for the match. poll() once per frame, then read what the frame needs.
export class GamepadInput {
  private frame: PadFrame = readPad(null);
  private previous: ReadonlySet<PadButton> = new Set();
  private previousFire = false;
  private pressedQueue = new Set<PadButton>();
  private fireEdge = false;
  private weaponSlot: 1 | 2 = 1;
  private connectedNow = false;

  constructor(private readonly getPads: () => readonly (PadSnapshot | null)[] = browserPads) {}

  get connected(): boolean {
    return this.connectedNow;
  }

  // Reads the first connected pad. Edges since the last poll are queued, so a press between two frames is not lost.
  poll(): void {
    let pad: PadSnapshot | null = null;
    try {
      pad = this.getPads().find((p): p is PadSnapshot => p !== null) ?? null;
    } catch {
      pad = null;
    }
    this.connectedNow = pad !== null;
    this.frame = readPad(pad);
    for (const b of this.frame.buttons) if (!this.previous.has(b)) this.pressedQueue.add(b);
    if (this.frame.fire && !this.previousFire) this.fireEdge = true;
    this.previous = this.frame.buttons;
    this.previousFire = this.frame.fire;
  }

  // Look delta in mouse-pixel units for a frame of dt seconds.
  look(dt: number): { dx: number; dy: number } {
    const k = LOOK_PIXELS_PER_SECOND * Math.max(0, dt);
    return { dx: this.frame.look.x * k, dy: this.frame.look.y * k };
  }

  buttons(): { fire: boolean; ads: boolean } {
    return { fire: this.frame.fire, ads: this.frame.ads };
  }

  held(bindings: Lookup): Set<string> {
    return heldCodes(this.frame, bindings);
  }

  // True once for each trigger pull since the last call (a click for semi-auto weapons).
  takeFireEdge(): boolean {
    const e = this.fireEdge;
    this.fireEdge = false;
    return e;
  }

  // Key codes of the actions pressed since the last call. Y swaps between the two weapon slots.
  drainPressed(bindings: Lookup): Set<string> {
    const out = new Set<string>();
    for (const b of this.pressedQueue) {
      for (const [action, button] of Object.entries(PAD_PRESSED) as [Action, PadButton][]) {
        if (button === b) out.add(bindings.get(action));
      }
      if (b === 'y') {
        this.weaponSlot = this.weaponSlot === 1 ? 2 : 1;
        out.add(bindings.get(this.weaponSlot === 1 ? 'weapon1' : 'weapon2'));
      }
    }
    this.pressedQueue = new Set();
    return out;
  }

  // The Start button was pressed since the last call (the match pauses).
  takeStart(): boolean {
    const had = this.pressedQueue.has('start');
    this.pressedQueue.delete('start');
    return had;
  }

  clear(): void {
    this.pressedQueue = new Set();
    this.fireEdge = false;
  }
}

function browserPads(): readonly (PadSnapshot | null)[] {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav === undefined || typeof nav.getGamepads !== 'function') return [];
  return Array.from(nav.getGamepads());
}
