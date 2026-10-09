import type { PlayerState } from '../sim/movement';

export type GameState = 'menu' | 'play' | 'paused';

// Read-only view published as window.__bp when the page is opened with ?debug.
export interface BpDebugView {
  readonly P: Readonly<PlayerState>;
  readonly shots: number;
  readonly hits: number;
  readonly state: GameState;
}

// What the game hands over. Getters, so the view always reads live values.
export interface BpDebugSource {
  player(): Readonly<PlayerState>;
  shots(): number;
  hits(): number;
  state(): GameState;
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
  };
  window.__bp = Object.freeze(view);
}
