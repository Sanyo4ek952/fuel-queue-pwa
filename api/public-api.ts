import { createHmac } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

const requestTimeoutMs = 9_000

type PublicApiRequest = AsyncIterable<Buffer | string> & {
  method?: string
  headers: IncomingHttpHeaders
  body?: unknown
  query?: Record<string, string | string[] | undefined>
  socket?: {
    remoteAddress?: string
  }
}

type PublicApiResponse = {
  status: (statusCode: number) => PublicApiResponse
  setHeader: (key: string, value: string) => PublicApiResponse
  end: (body: string) => void
}

type SupabaseConfig = {
  url: string | undefined
  anonKey: string | undefined
  serviceRoleKey: string | undefined
  rateLimitSalt: string | undefined
}

function normalizeSupabaseUrl(url: string | undefined) {
  return url?.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')
}

function getSupabaseConfig(): SupabaseConfig {
  return {
    url: normalizeSupabaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    rateLimitSalt: process.env.PUBLIC_QUEUE_RATE_LIMIT_SALT,
  }
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function sendJson(
  response: PublicApiResponse,
  statusCode: number,
  payload: unknown,
  cacheControl = 'no-store',
) {
  response.status(statusCode).setHeader('content-type', 'application/json')
  response.setHeader('cache-control', cacheControl)
  response.end(JSON.stringify(payload))
}

function getForwardedIp(request: PublicApiRequest) {
  const forwardedIp = (
    firstValue(request.headers['x-forwarded-for']) ||
    firstValue(request.headers['x-real-ip']) ||
    firstValue(request.headers['cf-connecting-ip']) ||
    request.socket?.remoteAddress ||
    ''
  )

  return forwardedIp.split(',')[0]?.trim() ?? ''
}

function hashClientIp(clientIp: string, salt: string) {
  return createHmac('sha256', salt).update(clientIp).digest('hex')
}

async function readBody(request: PublicApiRequest) {
  if (request.body && typeof request.body === 'object') {
    return request.body
  }

  const chunks = []

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  const rawBody = Buffer.concat(chunks).toString('utf8')

  return rawBody ? (JSON.parse(rawBody) as unknown) : {}
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

function getSupabaseErrorMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }

  const body = value as { message?: unknown; error?: unknown }

  return typeof body.message === 'string'
    ? body.message
    : typeof body.error === 'string'
      ? body.error
      : fallback
}

async function handlePublicQueueCheck(request: PublicApiRequest, response: PublicApiResponse) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  const { url, serviceRoleKey, rateLimitSalt } = getSupabaseConfig()

  if (!url || !serviceRoleKey) {
    sendJson(response, 500, { error: 'Supabase is not configured.' })
    return
  }

  if (!rateLimitSalt) {
    sendJson(response, 500, { error: 'Public queue rate limit is not configured.' })
    return
  }

  try {
    const body = await readBody(request)
    const requestBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const plateNumber = typeof requestBody.plateNumber === 'string' ? requestBody.plateNumber : ''
    const phoneLast4 = typeof requestBody.phoneLast4 === 'string' ? requestBody.phoneLast4 : ''
    const forwardedIp = getForwardedIp(request)

    if (!forwardedIp) {
      sendJson(response, 400, { error: 'Client IP is unavailable.' })
      return
    }

    const clientIpHash = hashClientIp(forwardedIp, rateLimitSalt)
    const supabaseResponse = await fetchWithTimeout(
      `${url}/rest/v1/rpc/check_public_queue_position`,
      {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          plate_number: plateNumber,
          phone_last4: phoneLast4,
          client_ip_hash: clientIpHash,
        }),
      },
    )
    const responseBody = await supabaseResponse.json().catch(() => null)

    if (!supabaseResponse.ok) {
      sendJson(response, supabaseResponse.status, {
        error: getSupabaseErrorMessage(responseBody, 'Public queue check failed.'),
      })
      return
    }

    sendJson(response, 200, responseBody)
  } catch (error) {
    sendJson(response, 504, {
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Supabase request timed out.'
          : 'Public queue check failed.',
    })
  }
}

async function handlePublicNoShowGrace(request: PublicApiRequest, response: PublicApiResponse) {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed.' }, 'public, max-age=60, stale-while-revalidate=300')
    return
  }

  const { url, anonKey } = getSupabaseConfig()

  if (!url || !anonKey) {
    sendJson(response, 500, { error: 'Supabase is not configured.' }, 'public, max-age=60, stale-while-revalidate=300')
    return
  }

  try {
    const supabaseResponse = await fetchWithTimeout(
      `${url}/rest/v1/rpc/get_reservation_no_show_grace_days`,
      {
        method: 'POST',
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          'content-type': 'application/json',
        },
        body: '{}',
      },
    )
    const responseBody = await supabaseResponse.json().catch(() => null)

    if (!supabaseResponse.ok) {
      sendJson(
        response,
        supabaseResponse.status,
        { error: getSupabaseErrorMessage(responseBody, 'Public no-show grace check failed.') },
        'public, max-age=60, stale-while-revalidate=300',
      )
      return
    }

    sendJson(
      response,
      200,
      {
        days: Number.isFinite(Number(responseBody)) ? Math.trunc(Number(responseBody)) : 0,
        updated_at: null,
        client_mutation_id: null,
      },
      'public, max-age=60, stale-while-revalidate=300',
    )
  } catch (error) {
    sendJson(
      response,
      504,
      {
        error:
          error instanceof Error && error.name === 'AbortError'
            ? 'Supabase request timed out.'
            : 'Public no-show grace check failed.',
      },
      'public, max-age=60, stale-while-revalidate=300',
    )
  }
}

export default function handler(request: PublicApiRequest, response: PublicApiResponse) {
  const action = firstValue(request.query?.action)

  if (action === 'public-queue-check') {
    return handlePublicQueueCheck(request, response)
  }

  if (action === 'public-no-show-grace') {
    return handlePublicNoShowGrace(request, response)
  }

  sendJson(response, 404, { error: 'Public API action not found.' })
}
