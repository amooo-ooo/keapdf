import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.ico',
        'favicon.svg',
        'apple-touch-icon-180x180.png',
        'icons.svg',
        'robots.txt',
        'sample.pdf',
        'llms.txt',
        'ai-catalog.json',
        '.well-known/*',
        'fonts/*.woff2',
        'fonts/*.css',
        'cursors/*.svg',
        'cursors/*.png',
      ],
      manifest: {
        name: 'Kea PDF',
        short_name: 'Kea PDF',
        description: 'Fast, privacy-focused, browser-native PDF editor built with Svelte 5 and PDFium WebAssembly.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib'),
    },
  },
  css: {
    devSourcemap: true,
  },
  server: {
    port: 3000,
    open: true,
    cors: true,
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        fs.realpathSync(process.cwd()),
      ],
    },
  },
  preview: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
      output: {
        manualChunks(id: string): string | void {
          if (id.includes('node_modules')) {
            if (id.includes('@embedpdf/pdfium')) return 'vendor-pdfium';
            if (id.includes('node-forge')) return 'vendor-forge';
            if (id.includes('pdf-lib')) return 'vendor-pdf-lib';
            if (id.includes('lucide-svelte') || id.includes('@lucide/svelte')) return 'vendor-icons';
            return 'vendor-ui';
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ['pdf-lib', 'node-forge', 'tesseract.js'],
    exclude: [
      '@embedpdf/pdfium',
      'lucide-svelte',
      'bits-ui',
      'paneforge',
      'runed',
      'svelte-toolbelt',
    ],
  },
  assetsInclude: ['**/*.wasm'],
});
