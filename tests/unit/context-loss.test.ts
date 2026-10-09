import { describe, it, expect } from 'vitest';
import { createContextLossHandler } from '../../src/render/context-loss';

// Node's EventTarget accepts dispatched Events, which is all the handler uses.
class FakeCanvas extends EventTarget {}

function setup(): {
  canvas: FakeCanvas;
  log: string[];
  handler: ReturnType<typeof createContextLossHandler>;
} {
  const log: string[] = [];
  const handler = createContextLossHandler({
    onLost: () => log.push('lost'),
    onRestored: () => log.push('restored'),
  });
  const canvas = new FakeCanvas();
  handler.attach(canvas as unknown as HTMLCanvasElement);
  return { canvas, log, handler };
}

describe('context loss handler', () => {
  it('calls onLost then onRestored on the matching canvas events', () => {
    const { canvas, log, handler } = setup();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(log).toEqual(['lost']);
    expect(handler.lost).toBe(true);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(log).toEqual(['lost', 'restored']);
    expect(handler.lost).toBe(false);
  });

  it('calls preventDefault on the lost event', () => {
    const { canvas } = setup();
    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('stops calling back after detach', () => {
    const { canvas, log, handler } = setup();
    handler.detach();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(log).toEqual([]);
  });

  it('attaching twice does not double the callbacks', () => {
    const { canvas, log, handler } = setup();
    handler.attach(canvas as unknown as HTMLCanvasElement);
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(log).toEqual(['lost']);
  });
});
