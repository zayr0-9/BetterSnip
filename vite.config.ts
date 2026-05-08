import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.resolve(__dirname, 'src', 'renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist', 'renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        settings: path.resolve(__dirname, 'src', 'renderer', 'settings.html'),
        annotate: path.resolve(__dirname, 'src', 'renderer', 'annotate.html'),
        overlay: path.resolve(__dirname, 'src', 'renderer', 'overlay.html'),
        recorder: path.resolve(__dirname, 'src', 'renderer', 'recorder.html')
      }
    }
  }
});
