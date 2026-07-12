const requestTimeoutMs = 9_000

type DailyLimitOverviewRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer>
}

type DailyLimitOverviewResponse = {
  status: (statusCode: number) => DailyLimitOverviewResponse
  setHeader: (key: string, value: string) => DailyLimitOverviewResponse
  end: (body: string) => void
}

function normalizeSupabaseUrl(url: string | undefined) {
  return url?.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')
}

function getSupabaseConfig() {
  return {
    url: normalizeSupabaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  }
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getBearerToken(request: DailyLimitOverviewRequest) {
  const authorization = firstHeaderValue(request.headers.authorization)
  const match = authorization?.match(/^Bearer\s+(.+)$/i)

  return match?.[1] ?? null
}

function sendJson(response: DailyLimitOverviewResponse, statusCode: number, payload: unknown) {
  response.status(statusCode).setHeader('content-type', 'application/json')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

async function readBody(request: DailyLimitOverviewRequest) {
  if (request.body && typeof request.body === 'object') {
    return request.body as Record<string, unknown>
  }

  if (!request[Symbol.asyncIterator]) {
    return {}
  }

  const chunks: Buffer[] = []

  for await (const chunk of request as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const rawBody = Buffer.concat(chunks).toString('utf8')

  return rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
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

export default async function handler(
  request: DailyLimitOverviewRequest,
  response: DailyLimitOverviewResponse,
) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  const { url, anonKey } = getSupabaseConfig()
  const accessToken = getBearerToken(request)

  if (!url || !anonKey) {
    sendJson(response, 500, { error: 'Supabase is not configured.' })
    return
  }

  if (!accessToken) {
    sendJson(response, 401, { error: 'Authorization token is required.' })
    return
  }

  try {
    const body = await readBody(request)
    const supabaseResponse = await fetchWithTimeout(
      `${url}/rest/v1/rpc/get_daily_limit_overview`,
      {
        method: 'POST',
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          target_date: body.date ?? null,
        }),
      },
    )
    const responseBody = await supabaseResponse.json().catch(() => null)

    if (!supabaseResponse.ok) {
      sendJson(response, supabaseResponse.status, {
        error: getSupabaseErrorMessage(responseBody, 'Daily limit overview request failed.'),
      })
      return
    }

    sendJson(response, 200, responseBody)
  } catch (error) {
    sendJson(response, 504, {
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Supabase request timed out.'
          : 'Daily limit overview request failed.',
    })
  }
}
