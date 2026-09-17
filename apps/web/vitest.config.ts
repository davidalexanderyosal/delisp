import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Only the DOM-free logic is unit-tested here — curriculum, progression,
 * fading, diagnostic voting. The React screens are covered by the headless
 * browser smoke test instead.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@delisp/dsp': fileURLToPath(new URL('../../packages/dsp/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
