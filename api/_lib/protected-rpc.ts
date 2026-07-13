import {
  AuthSessionError,
  assertSameOriginRequest,
  getServerAuthSession,
  getSupabaseConfig,
} from './auth-session.js'

const requestTimeoutMs = 9_000

export type ProtectedRpcRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer>
}

export type ProtectedRpcResponse = {
  status: (statusCode: number) => ProtectedRpcResponse
  setHeader: (key: string, value: string | string[]) => ProtectedRpcResponse
  end: (body: string) => void
}

export type ProtectedRpcOptions = {
  rpcName: string
  fallbackError: string
  mapBody: (body: Record<string, unknown>) => Record<string, unknown>
}

export function sendJson(response: ProtectedRpcResponse, statusCode: number, payload: unknown) {
  response.status(statusCode).setHeader('content-type', 'application/json')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

export async function readBody(request: ProtectedRpcRequest) {
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

export async function fetchWithTimeout(url: string, init: RequestInit) {
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

export function getSupabaseErrorMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }

  const body = value as {
    code?: unknown
    details?: unknown
    message?: unknown
    error?: unknown
  }
  const errorText = [body.message, body.error, body.details, body.code]
    .filter((item): item is string => typeof item === 'string')
    .join(' ')

  if (errorText.includes('fueling_records_allocation_id_fkey')) {
    return 'ALLOCATION_NOT_ACTIVE'
  }

  return typeof body.message === 'string'
    ? body.message
    : typeof body.error === 'string'
      ? body.error
      : fallback
}

export async function handleProtectedRpc(
  request: ProtectedRpcRequest,
  response: ProtectedRpcResponse,
  options: ProtectedRpcOptions,
) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  const { url, anonKey } = getSupabaseConfig()

  if (!url || !anonKey) {
    sendJson(response, 500, { error: 'Supabase is not configured.' })
    return
  }

  try {
    assertSameOriginRequest(request)
    const session = await getServerAuthSession({
      request,
      response,
      config: { url, anonKey },
      verifyUser: false,
    })
    const body = await readBody(request)
    const supabaseResponse = await fetchWithTimeout(`${url}/rest/v1/rpc/${options.rpcName}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${session.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(options.mapBody(body)),
    })
    const responseBody = await supabaseResponse.json().catch(() => null)

    if (!supabaseResponse.ok) {
      sendJson(response, supabaseResponse.status, {
        error: getSupabaseErrorMessage(responseBody, options.fallbackError),
      })
      return
    }

    sendJson(response, 200, responseBody)
  } catch (error) {
    if (error instanceof AuthSessionError) {
      sendJson(response, error.statusCode, { error: error.message })
      return
    }

    sendJson(response, 504, {
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Supabase request timed out.'
          : options.fallbackError,
    })
  }
}
