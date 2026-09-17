import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * The AudioWorklet is bundled separately into `public/worklets/` as a single
 * self-contained IIFE.
 *
 * Two reasons it cannot just be another module in the main graph: worklet
 * globals (`registerProcessor`, `sampleRate`) only exist inside the worklet
 * scope, and `import` statements inside a worklet are not reliably supported on
 * iOS Safari. Bundling to one file means the DSP code is the *same* code the
 * unit tests cover — no hand-maintained copy of the FFT living in `public/`.
 */
const dspSrc = fileURLToPath(new URL('../../packages/dsp/src/index.ts', import.meta.url));
const entry = fileURLToPath(new URL('./src/worklet/feature-processor.worklet.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@delisp/dsp': dspSrc },
  },
  // Nothing to copy: this build emits a single file into the public directory.
  publicDir: false,
  build: {
    outDir: 'public/worklets',
    emptyOutDir: false,
    target: 'es2020',
    minify: false,
    sourcemap: false,
    lib: {
      entry,
      formats: ['iife'],
      name: 'DelispFeatureWorklet',
      fileName: () => 'feature-processor.js',
    },
  },
});
