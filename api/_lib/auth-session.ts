const accessCookieName = 'azs_sb_access'
const refreshCookieName = 'azs_sb_refresh'
const accessCookieMaxAgeSeconds = 60 * 60
const refreshCookieMaxAgeSeconds = 60 * 60 * 24 * 30
const refreshSkewSeconds = 60
const requestTimeoutMs = 9_000

export type AuthSessionRequest = {
  headers: Record<string, string | string[] | undefined>
}

export type AuthSessionResponse = {
  setHeader: (key: string, value: string | string[]) => unknown
}

export type SupabaseConfig = {
  url: string | undefined
  anonKey: string | undefined
}

export type ServerAuthSession = {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  user: unknown
}

type SupabaseTokenResponse = {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  expires_at?: unknown
  user?: unknown
  error?: unknown
  error_description?: unknown
  msg?: unknown
}

type CookieOptions = {
  maxAgeSeconds: number
  httpOnly?: boolean
}

export class AuthSessionError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.statusCode = statusCode
  }
}

export function normalizeSupabaseUrl(url: string | undefined) {
  return url?.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '')
}

export function getSupabaseConfig(): SupabaseConfig {
  return {
    url: normalizeSupabaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  }
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function getBearerToken(request: AuthSessionRequest) {
  const authorization = firstHeaderValue(request.headers.authorization)
  const match = authorization?.match(/^Bearer\s+(.+)$/i)

  return match?.[1]?.trim() || null
}

function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>()

  if (!header) {
    return cookies
  }

  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=')
    const name = rawName?.trim()

    if (!name) {
      continue
    }

    cookies.set(name, decodeURIComponent(rawValue.join('=')))
  }

  return cookies
}

function serializeCookie(name: string, value: string, options: CookieOptions) {
  const encodedValue = encodeURIComponent(value)
  const parts = [
    `${name}=${encodedValue}`,
    'Path=/',
    `Max-Age=${options.maxAgeSeconds}`,
    'SameSite=Lax',
    'Secure',
  ]

  if (options.httpOnly ?? true) {
    parts.push('HttpOnly')
  }

  return parts.join('; ')
}

function clearCookie(name: string) {
  return [
    `${name}=`,
    'Path=/',
    'Max-Age=0',
    'SameSite=Lax',
    'Secure',
    'HttpOnly',
  ].join('; ')
}

function getJwtExpiresAt(accessToken: string | null) {
  if (!accessToken) {
    return null
  }

  const [, payload] = accessToken.split('.')

  if (!payload) {
    return null
  }

  try {
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/')
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      '=',
    )
    const value = JSON.parse(Buffer.from(paddedPayload, 'base64').toString('utf8')) as {
      exp?: unknown
    }

    return typeof value.exp === 'number' && Number.isFinite(value.exp) ? value.exp : null
  } catch {
    return null
  }
}

export function setSessionCookies(
  response: AuthSessionResponse,
  session: Pick<ServerAuthSession, 'accessToken' | 'refreshToken' | 'expiresAt'>,
) {
  const accessMaxAge =
    session.expiresAt && Number.isFinite(session.expiresAt)
      ? Math.max(session.expiresAt - Math.floor(Date.now() / 1000), 60)
      : accessCookieMaxAgeSeconds

  response.setHeader('set-cookie', [
    serializeCookie(accessCookieName, session.accessToken, {
      maxAgeSeconds: accessMaxAge,
    }),
    serializeCookie(refreshCookieName, session.refreshToken, {
      maxAgeSeconds: refreshCookieMaxAgeSeconds,
    }),
  ])
}

export function clearSessionCookies(response: AuthSessionResponse) {
  response.setHeader('set-cookie', [clearCookie(accessCookieName), clearCookie(refreshCookieName)])
}

export function getSessionCookies(request: AuthSessionRequest) {
  const cookies = parseCookies(firstHeaderValue(request.headers.cookie))

  return {
    accessToken: cookies.get(accessCookieName) ?? null,
    refreshToken: cookies.get(refreshCookieName) ?? null,
  }
}

export function assertSameOriginRequest(request: AuthSessionRequest) {
  const origin = firstHeaderValue(request.headers.origin)
  const host = firstHeaderValue(request.headers.host)

  if (!origin) {
    return
  }

  if (!host) {
    throw new AuthSessionError('Request host is required.', 403)
  }

  let originHost = ''

  try {
    originHost = new URL(origin).host
  } catch {
    throw new AuthSessionError('Request origin is invalid.', 403)
  }

  if (originHost !== host) {
    throw new AuthSessionError('Request origin is not allowed.', 403)
  }
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

function getSupabaseAuthError(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }

  const body = value as SupabaseTokenResponse

  return typeof body.error_description === 'string'
    ? body.error_description
    : typeof body.msg === 'string'
      ? body.msg
      : typeof body.error === 'string'
        ? body.error
        : fallback
}

function parseTokenResponse(value: SupabaseTokenResponse): ServerAuthSession {
  if (typeof value.access_token !== 'string' || typeof value.refresh_token !== 'string') {
    throw new AuthSessionError('Supabase auth response is invalid.', 502)
  }

  const expiresAt =
    typeof value.expires_at === 'number'
      ? value.expires_at
      : typeof value.expires_in === 'number'
        ? Math.floor(Date.now() / 1000) + value.expires_in
        : null

  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresAt,
    user: value.user ?? null,
  }
}

export async function requestPasswordSession(params: {
  email: string
  password: string
  config: SupabaseConfig
}): Promise<ServerAuthSession> {
  if (!params.config.url || !params.config.anonKey) {
    throw new AuthSessionError('Supabase is not configured.', 500)
  }

  const response = await fetchWithTimeout(`${params.config.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: params.config.anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: params.email,
      password: params.password,
    }),
  })
  const body = (await response.json().catch(() => null)) as SupabaseTokenResponse | null

  if (!response.ok) {
    throw new AuthSessionError(getSupabaseAuthError(body, 'Login request failed.'), response.status)
  }

  return parseTokenResponse(body ?? {})
}

export async function refreshServerSession(params: {
  refreshToken: string
  config: SupabaseConfig
}): Promise<ServerAuthSession> {
  if (!params.config.url || !params.config.anonKey) {
    throw new AuthSessionError('Supabase is not configured.', 500)
  }

  const response = await fetchWithTimeout(`${params.config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: params.config.anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      refresh_token: params.refreshToken,
    }),
  })
  const body = (await response.json().catch(() => null)) as SupabaseTokenResponse | null

  if (!response.ok) {
    throw new AuthSessionError(getSupabaseAuthError(body, 'Session refresh failed.'), response.status)
  }

  return parseTokenResponse(body ?? {})
}

export async function fetchSupabaseUser(params: {
  accessToken: string
  config: SupabaseConfig
}) {
  if (!params.config.url || !params.config.anonKey) {
    throw new AuthSessionError('Supabase is not configured.', 500)
  }

  const response = await fetchWithTimeout(`${params.config.url}/auth/v1/user`, {
    headers: {
      apikey: params.config.anonKey,
      authorization: `Bearer ${params.accessToken}`,
    },
  })
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    throw new AuthSessionError(getSupabaseAuthError(body, 'Authorization token is invalid.'), response.status)
  }

  return body
}

export async function signOutServerSession(params: {
  accessToken: string | null
  config: SupabaseConfig
}) {
  if (!params.accessToken || !params.config.url || !params.config.anonKey) {
    return
  }

  await fetchWithTimeout(`${params.config.url}/auth/v1/logout`, {
    method: 'POST',
    headers: {
      apikey: params.config.anonKey,
      authorization: `Bearer ${params.accessToken}`,
    },
  }).catch(() => undefined)
}

function shouldRefresh(expiresAt: number | null) {
  return Boolean(expiresAt && expiresAt - Math.floor(Date.now() / 1000) <= refreshSkewSeconds)
}

async function refreshSessionWithCookies(params: {
  refreshToken: string
  config: SupabaseConfig
  response?: AuthSessionResponse
}) {
  try {
    const refreshed = await refreshServerSession({
      refreshToken: params.refreshToken,
      config: params.config,
    })

    if (params.response) {
      setSessionCookies(params.response, refreshed)
    }

    return refreshed
  } catch (error) {
    if (params.response) {
      clearSessionCookies(params.response)
    }

    if (error instanceof AuthSessionError) {
      throw new AuthSessionError(error.message, 401)
    }

    throw error
  }
}

export async function getServerAuthSession(params: {
  request: AuthSessionRequest
  response?: AuthSessionResponse
  config?: SupabaseConfig
  verifyUser?: boolean
}): Promise<ServerAuthSession> {
  const config = params.config ?? getSupabaseConfig()
  const cookies = getSessionCookies(params.request)
  const refreshToken = cookies.refreshToken
  const bearerToken = getBearerToken(params.request)

  if (!refreshToken) {
    if (bearerToken) {
      const user = params.verifyUser === false ? null : await fetchSupabaseUser({ accessToken: bearerToken, config })

      return {
        accessToken: bearerToken,
        refreshToken: '',
        expiresAt: null,
        user,
      }
    }

    throw new AuthSessionError('Authorization token is required.', 401)
  }

  if (!cookies.accessToken) {
    return refreshSessionWithCookies({ refreshToken, config, response: params.response })
  }

  const accessTokenExpiresAt = getJwtExpiresAt(cookies.accessToken)

  if (shouldRefresh(accessTokenExpiresAt)) {
    return refreshSessionWithCookies({ refreshToken, config, response: params.response })
  }

  if (params.verifyUser === false) {
    return {
      accessToken: cookies.accessToken,
      refreshToken,
      expiresAt: accessTokenExpiresAt,
      user: null,
    }
  }

  const user = await fetchSupabaseUser({ accessToken: cookies.accessToken, config }).catch(async (error) => {
    if (!(error instanceof AuthSessionError) || error.statusCode !== 401) {
      throw error
    }

    const refreshed = await refreshSessionWithCookies({
      refreshToken,
      config,
      response: params.response,
    })

    return { refreshed }
  })

  if (user && typeof user === 'object' && 'refreshed' in user) {
    return user.refreshed as ServerAuthSession
  }

  return {
    accessToken: cookies.accessToken,
    refreshToken,
    expiresAt: accessTokenExpiresAt,
    user,
  }
}

export function toPublicSession(session: Pick<ServerAuthSession, 'expiresAt' | 'user'>) {
  return {
    expires_at: session.expiresAt,
    user: session.user,
  }
}
