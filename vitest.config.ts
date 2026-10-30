import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Some tests load large libraries (PDF, images) for the first time; Windows runners are slow to do that.
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 60_000 },
});
