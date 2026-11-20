import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    build: { minify: true },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'binwise-dev-csp',
        apply: 'serve',
        transformIndexHtml: html => html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"),
      },
    ],
  },
})
