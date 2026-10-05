import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { cpSync } from 'node:fs'

// `data/` (the shippable dump) lives at the repo root; dev serves it as-is, the build copies it into dist.
// 404.html is the GitHub Pages fallback (routing is hash based, so it only needs to boot the same app).
const copyData = () => ({
  name: 'copy-data',
  apply: 'build',
  closeBundle() {
    cpSync('data', 'dist/data', { recursive: true })
    cpSync('dist/index.html', 'dist/404.html')
  }
})

export default defineConfig({
  base: process.env.BASE_PATH ?? '/brazil-audit/',
  plugins: [vue({ features: { vapor: true } }), copyData()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 600 }
})
