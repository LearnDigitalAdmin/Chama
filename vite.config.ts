import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pwaSeo from './tools/vite-plugin-pwa-seo.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), pwaSeo()],
})
