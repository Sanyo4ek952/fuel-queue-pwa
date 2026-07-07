import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

function getManualChunk(id: string) {
  const normalizedId = id.replaceAll('\\', '/')

  if (!normalizedId.includes('node_modules')) {
    return
  }

  if (
    normalizedId.includes('/react/') ||
    normalizedId.includes('/react-dom/') ||
    normalizedId.includes('/react-router-dom/')
  ) {
    return 'react-vendor'
  }

  if (
    normalizedId.includes('/@tanstack/react-query/') ||
    normalizedId.includes('/@supabase/supabase-js/') ||
    normalizedId.includes('/dexie/')
  ) {
    return 'data-vendor'
  }

  if (
    normalizedId.includes('/radix-ui/') ||
    normalizedId.includes('/lucide-react/') ||
    normalizedId.includes('/sonner/') ||
    normalizedId.includes('/class-variance-authority/')
  ) {
    return 'ui-vendor'
  }

  if (normalizedId.includes('/date-fns/')) {
    return 'date-vendor'
  }

  return 'vendor'
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      manifest: {
        name: 'Fuel Queue PWA',
        short_name: 'FuelQueue',
        display: 'standalone',
        start_url: '/',
        theme_color: '#0f172a',
        background_color: '#0f172a',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: getManualChunk,
      },
    },
  },
})
