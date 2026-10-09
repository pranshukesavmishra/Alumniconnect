/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'badge-96.png', 'push-sw.js'],
      manifest: {
        name: 'JEC Alumni Connect',
        short_name: 'JEC Alumni',
        description: 'Every JECian, one tap away. Profiles, batches, events and more for Jabalpur Engineering College.',
        theme_color: '#0b4a37',
        background_color: '#F6F5F1',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'en-IN',
        categories: ['social', 'education'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        importScripts: ['push-sw.js'], // push notifications: show them and open the right screen on tap
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth\/v1/, /^\/rest\/v1/, /^\/storage\/v1/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // heavy, rarely used parts (PDF reader, ZIP, QR scanner) load on demand instead of being pre-cached
        globIgnores: ['**/pdf-*.js', '**/pdf.worker*.mjs', '**/jszip*.js', '**/qr-scanner*.js', '**/browser-*.js'],
        maximumFileSizeToCacheInBytes: 1_000_000,
        runtimeCaching: [
          {
            // Public photos and avatars: cache on the phone so galleries open instantly and save data.
            urlPattern: ({ url }) => url.pathname.startsWith('/storage/v1/object/public/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'public-images',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
