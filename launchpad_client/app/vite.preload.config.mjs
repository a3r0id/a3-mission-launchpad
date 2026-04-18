import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['node-ssh', 'ssh2', 'cpu-features'],
    },
  },
  optimizeDeps: {
    exclude: ['node-ssh', 'ssh2', 'cpu-features'],
  },
});
