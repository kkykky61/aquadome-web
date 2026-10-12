import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    environment: 'node',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          mqtt: ['mqtt'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
