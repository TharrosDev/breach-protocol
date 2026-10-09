import { describe, it, expect } from 'vitest';
import { detectCapabilities } from '../../src/app/capabilities';

function fakeDoc(ctx: unknown): Document {
  return {
    createElement: () => ({ getContext: (type: string) => (type === 'webgl2' ? ctx : null) }),
  } as unknown as Document;
}

describe('detectCapabilities', () => {
  it('reports webgl2 false when getContext returns null', () => {
    expect(detectCapabilities(fakeDoc(null)).webgl2).toBe(false);
  });

  it('reports webgl2 true when a context is returned', () => {
    expect(detectCapabilities(fakeDoc({})).webgl2).toBe(true);
  });
});
