import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // In local dev the serverless functions are served by scripts/dev-api.ts.
      '/api': { target: 'http://localhost:3001', changeOrigin: false },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'api/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
