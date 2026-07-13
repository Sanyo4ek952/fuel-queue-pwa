import {
  AuthSessionError,
  assertSameOriginRequest,
  getSupabaseConfig,
  requestPasswordSession,
  setSessionCookies,
  toPublicSession,
} from '../_lib/auth-session.js'

type LoginRequest = AsyncIterable<Buffer | string> & {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type LoginResponse = {
  status: (statusCode: number) => LoginResponse
  setHeader: (key: string, value: string | string[]) => LoginResponse
  end: (body: string) => void
}

function sendJson(response: LoginResponse, statusCode: number, payload: unknown) {
  response.status(statusCode).setHeader('content-type', 'application/json')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(payload))
}

async function readBody(request: LoginRequest) {
  if (request.body && typeof request.body === 'object') {
    return request.body as Record<string, unknown>
  }

  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  const rawBody = Buffer.concat(chunks).toString('utf8')

  return rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
}

function getErrorStatusCode(error: unknown) {
  return error instanceof AuthSessionError ? error.statusCode : 500
}

export default async function handler(request: LoginRequest, response: LoginResponse) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  try {
    assertSameOriginRequest(request)

    const body = await readBody(request)
    const email = typeof body.email === 'string' ? body.email : ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!email || !password) {
      sendJson(response, 400, { error: 'Email and password are required.' })
      return
    }

    const session = await requestPasswordSession({
      email,
      password,
      config: getSupabaseConfig(),
    })

    setSessionCookies(response, session)
    sendJson(response, 200, toPublicSession(session))
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      sendJson(response, 504, { error: 'Supabase request timed out.' })
      return
    }

    sendJson(response, getErrorStatusCode(error), {
      error: error instanceof Error ? error.message : 'Login request failed.',
    })
  }
}
