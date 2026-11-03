// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { proFlags } from './scripts/pro-flags.mjs';

// Keeper Pro: the interface reads the same switch as the main process (core/pro-switch.ts).
const PRO = proFlags(new URL('./', import.meta.url));

// The renderer. `npm run demo` serves it alone with demo data, so the UI can be
// worked on in any browser without touching the disk.
export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __KEEPER_PRO__: JSON.stringify(PRO.pro), __KEEPER_FREE_THROUGH__: JSON.stringify(PRO.freeThrough ?? '') },
  server: { port: 5180, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome140' },
});
