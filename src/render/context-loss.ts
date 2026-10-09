// WebGL context-loss handling (spec §4). The handler only tracks the event; the caller decides
// what to show and how to rebuild GPU resources through the callbacks.

export interface ContextLossCallbacks {
  onLost(): void;
  onRestored(): void;
}

export interface ContextLossHandler {
  attach(canvas: HTMLCanvasElement): void;
  detach(): void;
  readonly lost: boolean;
}

export function createContextLossHandler(callbacks: ContextLossCallbacks): ContextLossHandler {
  let canvas: HTMLCanvasElement | null = null;
  let lost = false;

  // preventDefault asks the browser to restore the context instead of leaving it dead.
  const onLost = (event: Event): void => {
    event.preventDefault();
    lost = true;
    callbacks.onLost();
  };

  const onRestored = (): void => {
    lost = false;
    callbacks.onRestored();
  };

  const handler: ContextLossHandler = {
    attach(target: HTMLCanvasElement): void {
      handler.detach();
      canvas = target;
      target.addEventListener('webglcontextlost', onLost);
      target.addEventListener('webglcontextrestored', onRestored);
    },
    detach(): void {
      if (canvas !== null) {
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
      }
      canvas = null;
    },
    get lost(): boolean {
      return lost;
    },
  };

  return handler;
}
