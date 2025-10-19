import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Root Vite config; outputs build to root-level dist
export default defineConfig({
  plugins: [react()],
  root: 'src/simple-traces/frontend',
  publicDir: 'src/simple-traces/frontend/public',
  build: {
    outDir: '../../../dist', // places dist at repository root
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
