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
  query?: Record<string, string | string[] | undefined>
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

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getSupabaseAuthError(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }

  const body = value as {
    error_description?: unknown
    msg?: unknown
    error?: unknown
  }

  return typeof body.error_description === 'string'
    ? body.error_description
    : typeof body.msg === 'string'
      ? body.msg
      : typeof body.error === 'string'
        ? body.error
        : fallback
}

async function fetchSupabaseAuth(path: string, body: unknown, fallback: string) {
  const config = getSupabaseConfig()

  if (!config.url || !config.anonKey) {
    throw new AuthSessionError('Supabase is not configured.', 500)
  }

  const response = await fetch(`${config.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const value = await response.json().catch(() => null)

  if (!response.ok) {
    const error = new AuthSessionError(getSupabaseAuthError(value, fallback), response.status)
    const code = value && typeof value === 'object' && 'code' in value ? value.code : undefined

    if (typeof code === 'string') {
      ;(error as AuthSessionError & { code?: string }).code = code
    }

    throw error
  }

  return value
}

async function handleSignup(request: LoginRequest, response: LoginResponse) {
  const body = await readBody(request)
  const email = typeof body.email === 'string' ? body.email : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const data = body.data && typeof body.data === 'object' ? body.data : {}
  const captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken : undefined

  if (!email || !password) {
    sendJson(response, 400, { error: 'Email and password are required.' })
    return
  }

  await fetchSupabaseAuth(
    'signup',
    {
      email,
      password,
      data,
      ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}),
    },
    'Signup request failed.',
  )
  sendJson(response, 200, { ok: true })
}

async function handleResendSignupConfirmation(request: LoginRequest, response: LoginResponse) {
  const body = await readBody(request)
  const email = typeof body.email === 'string' ? body.email : ''
  const captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken : undefined

  if (!email) {
    sendJson(response, 400, { error: 'Email is required.' })
    return
  }

  await fetchSupabaseAuth(
    'resend',
    {
      type: 'signup',
      email,
      ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}),
    },
    'Resend signup confirmation request failed.',
  )
  sendJson(response, 200, { ok: true })
}

export default async function handler(request: LoginRequest, response: LoginResponse) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  try {
    assertSameOriginRequest(request)
    const action = firstQueryValue(request.query?.action)

    if (action === 'signup') {
      await handleSignup(request, response)
      return
    }

    if (action === 'resend-signup-confirmation') {
      await handleResendSignupConfirmation(request, response)
      return
    }

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

    const payload: { error: string; code?: string } = {
      error: error instanceof Error ? error.message : 'Login request failed.',
    }
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined

    if (typeof code === 'string') {
      payload.code = code
    }

    sendJson(response, getErrorStatusCode(error), payload)
  }
}
