import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const dspSrc = fileURLToPath(new URL('../../packages/dsp/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@delisp/dsp': dspSrc },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'worklets/feature-processor.js'],
      manifest: {
        name: 'Pronunciation Trainer',
        short_name: 'Speech',
        description: 'Real-time feedback for /s/ placement and speech clarity.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#080c17',
        theme_color: '#080c17',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        // The worklet must be available offline: without it there is no gauge.
        navigateFallbackDenylist: [/^\/worklets\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
