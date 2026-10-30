import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer. `npm run demo` serves it alone with demo data, so the UI can be
// worked on in any browser without touching the disk.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5180, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome140' },
});
