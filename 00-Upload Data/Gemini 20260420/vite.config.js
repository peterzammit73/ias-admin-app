import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext',
    // Increase the warning limit to 1000kb (1MB) to silence the warning 
    // if you don't want to split chunks aggressively.
    chunkSizeWarningLimit: 1000, 
    rollupOptions: {
      output: {
        // This function manually splits specific libraries into their own chunks
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Split Firebase into its own chunk
            if (id.includes('firebase')) {
              return 'firebase';
            }
            // Split React related packages
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react';
            }
            // Put remaining node_modules into a separate vendor chunk
            return 'vendor';
          }
        },
      },
    },
  }
});