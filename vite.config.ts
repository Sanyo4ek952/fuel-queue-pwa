import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Connect } from 'vite'

import currentProfileHandler from './api/current-profile.js'
import publicNoShowGraceHandler from './api/public-no-show-grace.js'
import publicQueueCheckHandler from './api/public-queue-check.js'

type LocalApiResponse = {
  statusCode: number
  status: (statusCode: number) => LocalApiResponse
  setHeader: (key: string, value: string) => LocalApiResponse
  end: (body: string) => void
}

type LocalApiHandler = (
  request: IncomingMessage,
  response: LocalApiResponse,
) => Promise<void> | void

function applyServerEnv(mode: string) {
  const env = loadEnv(mode, process.cwd(), '')

  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value
  }
}

function createLocalApiResponse(
  end: (statusCode: number, headers: Record<string, string>, body: string) => void,
): LocalApiResponse {
  const headers: Record<string, string> = {}
  const response: LocalApiResponse = {
    statusCode: 200,
    status(statusCode) {
      response.statusCode = statusCode
      return response
    },
    setHeader(key, value) {
      headers[key.toLowerCase()] = value
      return response
    },
    end(body) {
      end(response.statusCode, headers, body)
    },
  }

  return response
}

function mountLocalApiHandler(
  middlewares: Connect.Server,
  route: string,
  handler: LocalApiHandler,
  fallbackMessage: string,
) {
  middlewares.use(route, async (request, response) => {
    try {
      await handler(
        request,
        createLocalApiResponse((statusCode, headers, body) => {
          response.statusCode = statusCode

          for (const [key, value] of Object.entries(headers)) {
            response.setHeader(key, value)
          }

          response.end(body)
        }),
      )
    } catch (error) {
      response.statusCode = 500
      response.setHeader('content-type', 'application/json')
      response.setHeader('cache-control', 'no-store')
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : fallbackMessage,
        }),
      )
    }
  })
}

function localApiPlugin(mode: string): Plugin {
  return {
    name: 'local-api',
    configureServer(server) {
      applyServerEnv(mode)

      mountLocalApiHandler(
        server.middlewares,
        '/api/current-profile',
        currentProfileHandler,
        'Local current profile request failed.',
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/public-queue-check',
        publicQueueCheckHandler,
        'Local public queue check request failed.',
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/public-no-show-grace',
        publicNoShowGraceHandler,
        'Local public no-show grace request failed.',
      )
    },
  }
}

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
export default defineConfig(({ mode }) => ({
  plugins: [
    localApiPlugin(mode),
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
        name: 'АЗС Онлайн',
        short_name: 'АЗС Онлайн',
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
}))
