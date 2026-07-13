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
import queueBackupHandler from './api/queue-backup.js'

type LocalApiResponse = {
  statusCode: number
  status: (statusCode: number) => LocalApiResponse
  setHeader: (key: string, value: string | string[]) => LocalApiResponse
  json: (value: unknown) => void
  end: (body?: string | Buffer) => void
}

type LocalApiHandler = (
  request: IncomingMessage & { query?: Record<string, string | string[] | undefined> },
  response: LocalApiResponse,
) => Promise<void> | void

const protectedLocalApiRoutes = [
  ['approve-registration', 'Local approve registration request failed.'],
  ['cancel-my-reservation', 'Local cancel my reservation request failed.'],
  ['cancel-preferential-queue-entry', 'Local cancel preferential queue entry request failed.'],
  ['cancel-reservation', 'Local cancel reservation request failed.'],
  ['check-vehicle-access', 'Local check vehicle access request failed.'],
  ['complete-consumer-profile', 'Local complete consumer profile request failed.'],
  ['create-consumer-reservation', 'Local create consumer reservation request failed.'],
  ['create-consumer-vehicle', 'Local create consumer vehicle request failed.'],
  ['create-daily-limit', 'Local create daily limit request failed.'],
  ['create-fueling-record-for-allocation', 'Local create fueling record request failed.'],
  ['create-fueling-record-for-preferential-entry', 'Local create preferential fueling record request failed.'],
  ['create-manual-override', 'Local create manual override request failed.'],
  ['create-personal-vehicle-liter-limit', 'Local create personal vehicle liter limit request failed.'],
  ['create-preferential-queue', 'Local create preferential queue request failed.'],
  ['create-preferential-queue-entry', 'Local create preferential queue entry request failed.'],
  ['create-reservation', 'Local create reservation request failed.'],
  ['daily-limit-overview', 'Local daily limit overview request failed.'],
  ['deactivate-profile', 'Local deactivate profile request failed.'],
  ['get-cancelled-reservations', 'Local cancelled reservations request failed.'],
  ['get-daily-fueling-schedule', 'Local daily fueling schedule request failed.'],
  ['get-fueling-report', 'Local fueling report request failed.'],
  ['get-my-queue-status', 'Local get my queue status request failed.'],
  ['get-my-today-fueling-status', 'Local get my today fueling status request failed.'],
  ['get-no-show-grace', 'Local no-show grace request failed.'],
  ['get-refuel-cooldown', 'Local refuel cooldown request failed.'],
  ['list-active-preferential-queues', 'Local list active preferential queues request failed.'],
  ['list-managed-profiles', 'Local list managed profiles request failed.'],
  ['list-my-vehicles', 'Local list my vehicles request failed.'],
  ['record-personal-data-consent', 'Local record personal data consent request failed.'],
  ['reject-registration', 'Local reject registration request failed.'],
  ['reservation-call-log', 'Local reservation call log request failed.'],
  ['resident-fuel-norm', 'Local resident fuel norm request failed.'],
  ['set-daily-fueling-schedule', 'Local set daily fueling schedule request failed.'],
  ['set-no-show-grace', 'Local set no-show grace request failed.'],
  ['set-refuel-cooldown', 'Local set refuel cooldown request failed.'],
  ['set-resident-fuel-norm', 'Local set resident fuel norm request failed.'],
  ['sync-offline-mutation', 'Local sync offline mutation request failed.'],
  ['today-queue', 'Local today queue request failed.'],
  ['today-queue-authors', 'Local today queue authors request failed.'],
  ['unlink-my-vehicle', 'Local unlink my vehicle request failed.'],
  ['update-reservation-fuel-preference', 'Local update reservation fuel preference request failed.'],
  ['vehicle-access-cache', 'Local vehicle access cache request failed.'],
  ['vehicle-fueling-history', 'Local vehicle fueling history request failed.'],
  ['vehicle-recent-fueling-history', 'Local vehicle recent fueling history request failed.'],
] as const

function applyServerEnv(mode: string) {
  const env = loadEnv(mode, process.cwd(), '')

  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value
  }
}

function createLocalApiResponse(
  end: (statusCode: number, headers: Record<string, string | string[]>, body: string | Buffer) => void,
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
    json(value) {
      headers['content-type'] ??= 'application/json'
      end(response.statusCode, headers, JSON.stringify(value))
    },
    end(body) {
      end(response.statusCode, headers, body ?? '')
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
        '/api/queue-backup',
        queueBackupHandler,
        'Local queue backup request failed.',
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

      for (const [action, fallbackMessage] of protectedLocalApiRoutes) {
        mountLocalApiHandler(
          server.middlewares,
          `/api/${action}`,
          protectedRpcHandler,
          fallbackMessage,
          { action },
        )
      }
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
