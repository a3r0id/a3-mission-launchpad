import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      // Keep SSH stack as runtime deps; do not let Vite parse native .node bindings.
      external: ['node-ssh', 'ssh2', 'cpu-features'],
    },
  },
  optimizeDeps: {
    exclude: ['node-ssh', 'ssh2', 'cpu-features'],
  },
});
