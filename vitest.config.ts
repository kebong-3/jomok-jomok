import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  // Each RAG suite initializes a real index; limit concurrent cold starts on CI.
  test: { include: ['tests/**/*.test.ts'], maxWorkers: 2 },
});
