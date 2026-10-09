// Shared UI contracts for Phase 5. Implementations live in focus.ts, tokens.ts, screens/* and hud/*.

export type ColourMode = 'normal' | 'colourblind';

// Named colour tokens. Every token has a normal and a colour-blind value (spec §4, legacy ZONE_PALETTE 481-484 and -cb styles).
export type TokenName =
  | 'hostile'
  | 'friendly'
  | 'objective-idle'
  | 'objective-capturing'
  | 'objective-contested'
  | 'objective-captured'
  | 'health'
  | 'health-low'
  | 'hit'
  | 'kill'
  | 'warning'
  | 'good'
  | 'ink'
  | 'mute'
  | 'panel';

export interface FocusScope {
  // Moves focus into the scope and traps Tab inside it while active.
  activate(): void;
  deactivate(): void;
  // Focuses the first focusable control (screen change rule).
  focusFirst(): void;
  readonly active: boolean;
}

export interface ScreenHandle {
  readonly id: string;
  show(): void;
  hide(): void;
  readonly visible: boolean;
}

// Read-only snapshot of sim state for the HUD. The HUD never writes game state.
export interface HudView {
  hp: number;
  stamina: number;
  alive: boolean;
  downed: boolean;
  bleedout: number;
  respawnIn: number;
  weaponName: string;
  ammo: number;
  reserve: number;
  reloading: boolean;
  gadgets: { name: string; uses: number; key: string }[];
  breachCharges: number;
  breachKey: string;
  killstreakReady: string | null;
  killstreakKey: string;
  streak: number;
  nextStreakAt: number | null;
  score: number;
  reinforcements: number;
  hostilesAlive: number;
  operatorsAlive: number;
  operatorsTotal: number;
  squadOrder: 'ATTACK' | 'HOLD' | 'FOLLOW';
  tickets: number;
  ticketsStart: number;
  zones: { name: string; status: 'idle' | 'capturing' | 'contested' | 'captured'; prog: number }[];
  spotted: { label: string; x: number; y: number; z: number }[];
  whiteout: number; // 0..1, from flash
  hurt: number; // 0..1, from recent damage
  hitMarker: 'none' | 'hit' | 'kill' | 'head';
  feed: { text: string; cls: 'kill' | 'death' | 'good' | 'warn' | '' }[];
  prompt: string;
  announce: { text: string; sub: string } | null;
  compassYaw: number;
  playerX: number;
  playerZ: number;
}
