import { createHmac } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

const requestTimeoutMs = 9_000

type VercelRequestLike = AsyncIterable<Buffer | string> & {
  method?: string
  headers: IncomingHttpHeaders
  body?: unknown
  socket?: {
    remoteAddress?: string
  }
}

type VercelResponseLike = {
  status: (statusCode: number) => VercelResponseLike
  setHeader: (key: string, value: string) => VercelResponseLike
  end: (body: string) => void
}

type SupabaseConfig = {
  url: string | undefined
  serviceRoleKey: string | undefined
  rateLimitSalt: string | undefined
}

function normalizeSupabaseUrl(url: string | undefined) {
  return url?.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')
}

function getSupabaseConfig(): SupabaseConfig {
  return {
    url: normalizeSupabaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    rateLimitSalt: process.env.PUBLIC_QUEUE_RATE_LIMIT_SALT,
  }
}

function sendJson(response: VercelResponseLike, statusCode: number, payload: unknown) {
  response.status(statusCode).setHeader('content-type', 'application/json')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getForwardedIp(request: VercelRequestLike) {
  const forwardedIp = (
    firstHeaderValue(request.headers['x-forwarded-for']) ||
    firstHeaderValue(request.headers['x-real-ip']) ||
    firstHeaderValue(request.headers['cf-connecting-ip']) ||
    request.socket?.remoteAddress ||
    ''
  )

  return forwardedIp.split(',')[0]?.trim() ?? ''
}

function hashClientIp(clientIp: string, salt: string) {
  return createHmac('sha256', salt).update(clientIp).digest('hex')
}

async function readBody(request: VercelRequestLike) {
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

export default async function handler(request: VercelRequestLike, response: VercelResponseLike) {
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
        error:
          responseBody && typeof responseBody === 'object' && 'message' in responseBody && typeof responseBody.message === 'string'
            ? responseBody.message
            : 'Public queue check failed.',
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
