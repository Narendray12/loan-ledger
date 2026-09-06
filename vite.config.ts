/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// Served from a sub-path on GitHub Pages (BASE_PATH=/<repo>/ in the workflow); '/' elsewhere.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Let the dev server be reached through an ngrok tunnel (phone testing: camera, PWA, OTP).
  server: {
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io'],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Loan Ledger',
        short_name: 'Loans',
        description: 'Loan application register and monthly collection ledger',
        theme_color: '#f4f7f3',
        background_color: '#f4f7f3',
        display: 'standalone',
        start_url: base,
        scope: base,
        lang: 'en-IN',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: base + 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Never cache API calls: data lives in IndexedDB, not the HTTP cache.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/storage\//],
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
})
