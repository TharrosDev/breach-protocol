import type { PlayerState } from '../sim/movement';

// 'over' is a finished match on its debrief screen.
export type GameState = 'menu' | 'play' | 'paused' | 'over';

// Read-only view published as window.__bp when the page is opened with ?debug.
export interface BpDebugView {
  readonly P: Readonly<PlayerState>;
  readonly shots: number;
  readonly hits: number;
  readonly state: GameState;
  // The one write seam: sets the enemy ticket pool to n (E2E use, to reach the win without play).
  forceTickets(n: number): void;
}

// What the game hands over. Getters, so the view always reads live values.
export interface BpDebugSource {
  player(): Readonly<PlayerState>;
  shots(): number;
  hits(): number;
  state(): GameState;
  forceTickets(n: number): void;
}

declare global {
  interface Window {
    __bp?: BpDebugView;
  }
}

// Builds a getter-only, frozen view. Assigning to any field throws in strict mode.
export function installDebugHook(source: BpDebugSource): void {
  const view: BpDebugView = {
    get P() {
      return source.player();
    },
    get shots() {
      return source.shots();
    },
    get hits() {
      return source.hits();
    },
    get state() {
      return source.state();
    },
    forceTickets(n: number): void {
      source.forceTickets(n);
    },
  };
  window.__bp = Object.freeze(view);
}
