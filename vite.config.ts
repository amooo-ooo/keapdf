import path from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@embedpdf/pdfium')) return 'vendor-pdfium';
            if (id.includes('pdf-lib')) return 'vendor-pdf-lib';
            if (id.includes('lucide-svelte') || id.includes('@lucide/svelte')) return 'vendor-icons';
            
            const pkgPath = id.toString().split('node_modules/')[1];
            if (pkgPath.startsWith('@')) {
              const parts = pkgPath.split('/');
              return `${parts[0].slice(1)}-${parts[1]}`;
            }
            return pkgPath.split('/')[0];
          }
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@embedpdf/pdfium'],
  },
  assetsInclude: ['**/*.wasm'],
});
