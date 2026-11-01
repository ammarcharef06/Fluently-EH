import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (requestPath: string) => requestPath.slice('/api'.length)
      }
    }
  },
  build: { outDir: 'dist', emptyOutDir: true }
});
