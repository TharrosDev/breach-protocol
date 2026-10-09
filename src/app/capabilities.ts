export interface Capabilities {
  webgl2: boolean;
}

// WebGL2 is required by three.js r160 (the renderer does not fall back to WebGL1).
export function detectCapabilities(doc: Document = document): Capabilities {
  const canvas = doc.createElement('canvas');
  const ctx = canvas.getContext('webgl2');
  return { webgl2: ctx !== null };
}
