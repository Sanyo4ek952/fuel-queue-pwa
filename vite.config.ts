import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Connect } from 'vite'

import currentProfileHandler from './api/current-profile.js'
import authLoginHandler from './api/auth/login.js'
import authLogoutHandler from './api/auth/logout.js'
import authSessionHandler from './api/auth/session.js'
import protectedRpcHandler from './api/protected-rpc.js'
import publicApiHandler from './api/public-api.js'

type LocalApiResponse = {
  statusCode: number
  status: (statusCode: number) => LocalApiResponse
  setHeader: (key: string, value: string | string[]) => LocalApiResponse
  end: (body: string) => void
}

type LocalApiHandler = (
  request: IncomingMessage & { query?: Record<string, string | string[] | undefined> },
  response: LocalApiResponse,
) => Promise<void> | void

function applyServerEnv(mode: string) {
  const env = loadEnv(mode, process.cwd(), '')

  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value
  }
}

function createLocalApiResponse(
  end: (statusCode: number, headers: Record<string, string | string[]>, body: string) => void,
): LocalApiResponse {
  const headers: Record<string, string | string[]> = {}
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
  query?: Record<string, string | string[] | undefined>,
) {
  middlewares.use(route, async (request, response) => {
    try {
      await handler(
        Object.assign(request, { query }),
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
        '/api/auth/login',
        authLoginHandler,
        'Local login request failed.',
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/auth/session',
        authSessionHandler,
        'Local session request failed.',
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/auth/logout',
        authLogoutHandler,
        'Local logout request failed.',
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/public-queue-check',
        publicApiHandler,
        'Local public queue check request failed.',
        { action: 'public-queue-check' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/public-no-show-grace',
        publicApiHandler,
        'Local public no-show grace request failed.',
        { action: 'public-no-show-grace' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/today-queue',
        protectedRpcHandler,
        'Local today queue request failed.',
        { action: 'today-queue' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/today-queue-authors',
        protectedRpcHandler,
        'Local today queue authors request failed.',
        { action: 'today-queue-authors' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/daily-limit-overview',
        protectedRpcHandler,
        'Local daily limit overview request failed.',
        { action: 'daily-limit-overview' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/list-managed-profiles',
        protectedRpcHandler,
        'Local list managed profiles request failed.',
        { action: 'list-managed-profiles' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/approve-registration',
        protectedRpcHandler,
        'Local approve registration request failed.',
        { action: 'approve-registration' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/reject-registration',
        protectedRpcHandler,
        'Local reject registration request failed.',
        { action: 'reject-registration' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/deactivate-profile',
        protectedRpcHandler,
        'Local deactivate profile request failed.',
        { action: 'deactivate-profile' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/resident-fuel-norm',
        protectedRpcHandler,
        'Local resident fuel norm request failed.',
        { action: 'resident-fuel-norm' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/get-my-queue-status',
        protectedRpcHandler,
        'Local get my queue status request failed.',
        { action: 'get-my-queue-status' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/get-my-today-fueling-status',
        protectedRpcHandler,
        'Local get my today fueling status request failed.',
        { action: 'get-my-today-fueling-status' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/list-my-vehicles',
        protectedRpcHandler,
        'Local list my vehicles request failed.',
        { action: 'list-my-vehicles' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/check-vehicle-access',
        protectedRpcHandler,
        'Local check vehicle access request failed.',
        { action: 'check-vehicle-access' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/vehicle-fueling-history',
        protectedRpcHandler,
        'Local vehicle fueling history request failed.',
        { action: 'vehicle-fueling-history' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/vehicle-recent-fueling-history',
        protectedRpcHandler,
        'Local vehicle recent fueling history request failed.',
        { action: 'vehicle-recent-fueling-history' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/create-fueling-record-for-allocation',
        protectedRpcHandler,
        'Local create fueling record request failed.',
        { action: 'create-fueling-record-for-allocation' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/create-fueling-record-for-preferential-entry',
        protectedRpcHandler,
        'Local create preferential fueling record request failed.',
        { action: 'create-fueling-record-for-preferential-entry' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/reservation-call-log',
        protectedRpcHandler,
        'Local reservation call log request failed.',
        { action: 'reservation-call-log' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/update-reservation-fuel-preference',
        protectedRpcHandler,
        'Local update reservation fuel preference request failed.',
        { action: 'update-reservation-fuel-preference' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/cancel-reservation',
        protectedRpcHandler,
        'Local cancel reservation request failed.',
        { action: 'cancel-reservation' },
      )
      mountLocalApiHandler(
        server.middlewares,
        '/api/sync-offline-mutation',
        protectedRpcHandler,
        'Local sync offline mutation request failed.',
        { action: 'sync-offline-mutation' },
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
      injectRegister: 'script-defer',
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
