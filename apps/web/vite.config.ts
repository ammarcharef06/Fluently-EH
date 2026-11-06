import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/Fluently-EH/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (requestPath: string) => requestPath.slice('/api'.length)
      }
    }
  },
  build: { target: 'es2022', sourcemap: true }
});
