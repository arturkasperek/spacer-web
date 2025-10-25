import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    dedupe: ["three"]
  },
  base: "./",
  server: {
    host: true,
    // Add MIME type for .wasm files
    mimeTypes: {
      'application/wasm': ['wasm']
    },
    // Add headers for WASM files
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    }
  },
  // Ensure WASM files are served with correct headers
  optimizeDeps: {
    exclude: ['@kolarz3/zenkit']
  },
  // Configure assets handling for WASM
  assetsInclude: ['**/*.wasm'],
  build: {
    rollupOptions: {
      external: (id) => {
        // Don't bundle zenkit WASM, let it be served as asset
        if (id.includes('@kolarz3/zenkit') && id.includes('.wasm')) {
          return false;
        }
        return false;
      }
    }
  }
})