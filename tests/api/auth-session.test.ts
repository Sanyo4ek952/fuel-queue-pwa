import { afterEach, describe, expect, it, vi } from 'vitest'

import loginHandler from '../../api/auth/login.js'
import logoutHandler from '../../api/auth/logout.js'
import sessionHandler from '../../api/auth/session.js'

type TestRequest = AsyncIterable<Buffer | string> & {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type TestResponse = {
  statusCode: number
  headers: Record<string, string | string[]>
  body: string
  status: (statusCode: number) => TestResponse
  setHeader: (key: string, value: string | string[]) => TestResponse
  end: (body: string) => TestResponse
}

function createRequest(request: Omit<TestRequest, typeof Symbol.asyncIterator>): TestRequest {
  return {
    ...request,
    [Symbol.asyncIterator]: async function* () {},
  }
}

function createResponse() {
  const response: TestResponse = {
    statusCode: 200,
    headers: {},
    body: '',
    status: vi.fn((statusCode: number) => {
      response.statusCode = statusCode
      return response
    }),
    setHeader: vi.fn((key: string, value: string | string[]) => {
      response.headers[key.toLowerCase()] = value
      return response
    }),
    end: vi.fn((body: string) => {
      response.body = body
      return response
    }),
  }

  return response
}

function stubSupabaseEnv() {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key')
}

function createJsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('auth BFF endpoints', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('logs in with HttpOnly cookies without returning tokens', async () => {
    stubSupabaseEnv()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        createJsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          user: { id: 'auth-user-id', email: 'user@example.local' },
        }),
      ),
    )
    const response = createResponse()

    await loginHandler(
      createRequest({
        method: 'POST',
        headers: {
          host: 'app.example.local',
          origin: 'https://app.example.local',
        },
        body: {
          email: 'user@example.local',
          password: 'password123',
        },
      }),
      response,
    )

    const body = JSON.parse(response.body)
    const setCookie = response.headers['set-cookie']

    expect(response.statusCode).toBe(200)
    expect(body).toMatchObject({
      user: { id: 'auth-user-id', email: 'user@example.local' },
    })
    expect(JSON.stringify(body)).not.toContain('access-token')
    expect(JSON.stringify(body)).not.toContain('refresh-token')
    expect(setCookie).toEqual(
      expect.arrayContaining([
        expect.stringContaining('azs_sb_access=access-token'),
        expect.stringContaining('azs_sb_refresh=refresh-token'),
      ]),
    )
    expect((setCookie as string[]).join('\n')).toContain('HttpOnly')
    expect((setCookie as string[]).join('\n')).toContain('Secure')
    expect((setCookie as string[]).join('\n')).toContain('SameSite=Lax')
  })

  it('rejects cross-origin login posts', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await loginHandler(
      createRequest({
        method: 'POST',
        headers: {
          host: 'app.example.local',
          origin: 'https://evil.example.local',
        },
        body: {
          email: 'user@example.local',
          password: 'password123',
        },
      }),
      response,
    )

    expect(response.statusCode).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes session cookies without returning tokens', async () => {
    stubSupabaseEnv()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        createJsonResponse({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          user: { id: 'auth-user-id' },
        }),
      ),
    )
    const response = createResponse()

    await sessionHandler(
      createRequest({
        method: 'GET',
        headers: {
          cookie: 'azs_sb_refresh=refresh-token',
        },
      }),
      response,
    )

    const body = JSON.parse(response.body)
    const setCookie = response.headers['set-cookie'] as string[]

    expect(response.statusCode).toBe(200)
    expect(body).toEqual({
      expires_at: expect.any(Number),
      user: { id: 'auth-user-id' },
    })
    expect(JSON.stringify(body)).not.toContain('new-access-token')
    expect(setCookie.join('\n')).toContain('azs_sb_access=new-access-token')
    expect(setCookie.join('\n')).toContain('azs_sb_refresh=new-refresh-token')
  })

  it('clears cookies on logout', async () => {
    stubSupabaseEnv()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(createJsonResponse({})))
    const response = createResponse()

    await logoutHandler(
      createRequest({
        method: 'POST',
        headers: {
          host: 'app.example.local',
          origin: 'https://app.example.local',
          cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token',
        },
      }),
      response,
    )

    const setCookie = response.headers['set-cookie'] as string[]

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true })
    expect(setCookie.join('\n')).toContain('azs_sb_access=')
    expect(setCookie.join('\n')).toContain('Max-Age=0')
  })
})
