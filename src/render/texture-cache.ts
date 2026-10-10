// Procedural textures are drawn on a 2D canvas, which is slow on the main thread. The ones that are the same every
// time (fixed seed, fixed size) are made once per page and shared by every match. dispose() on a shared texture only
// frees its GPU copy; the next draw uploads it again, so callers may keep disposing as before.
const cache = new Map<string, unknown>();

export function cachedTexture<T>(key: string, make: () => T): T {
  if (cache.has(key)) return cache.get(key) as T;
  const value = make();
  cache.set(key, value);
  return value;
}

// Marks an object that never moves: its local matrix is computed once and not on every frame. three.js otherwise
// recomposes the matrix of every object in the scene on each render call.
export function freezeStatic<T extends { updateMatrix(): void; matrixAutoUpdate: boolean }>(obj: T): T {
  obj.updateMatrix();
  obj.matrixAutoUpdate = false;
  return obj;
}
