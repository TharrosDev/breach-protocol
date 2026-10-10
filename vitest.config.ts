import { defineConfig } from 'vitest/config';

// Keep the pool small: unbounded workers on a many-core box starve the machine for the whole run.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    pool: 'threads',
    poolOptions: { threads: { maxThreads: 3, minThreads: 1 } },
    fileParallelism: true,
    testTimeout: 30_000,
  },
});
