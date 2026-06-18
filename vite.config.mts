import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath } from 'node:url'
import manifest from './src/manifest'

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@': '/src',
      crypto: fileURLToPath(new URL('./src/shims/crypto.ts', import.meta.url)),
      'node:crypto': fileURLToPath(new URL('./src/shims/crypto.ts', import.meta.url)),
    },
  },
})
