import { afterEach, describe, expect, it, vi } from 'vitest'

import handler from '../../api/current-profile.js'

function createResponse() {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string | string[]>,
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

describe('/api/current-profile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('requires an authorization token', async () => {
    stubSupabaseEnv()
    const response = createResponse()

    await handler({ method: 'GET', headers: {} }, response)

    expect(response.statusCode).toBe(401)
    expect(JSON.parse(response.body)).toEqual({ error: 'Authorization token is required.' })
  })

  it('returns the current profile with assigned stations', async () => {
    stubSupabaseEnv()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse({ id: 'auth-user-id' }))
        .mockResolvedValueOnce(
          createJsonResponse([
            {
              id: 'profile-id',
              auth_user_id: 'auth-user-id',
              full_name: 'Test User',
              role: 'cashier',
              is_active: true,
              approval_status: 'approved',
            },
          ]),
        )
        .mockResolvedValueOnce(
          createJsonResponse([
            {
              stations: {
                id: 'station-id',
                name: 'AZS #1',
                address: null,
              },
            },
          ]),
        ),
    )
    const response = createResponse()

    await handler(
      {
        method: 'GET',
        headers: {
          cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token',
        },
      },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      id: 'profile-id',
      stations: [{ id: 'station-id', name: 'AZS #1', address: null }],
    })
  })

  it('accepts a verified bearer token when session cookies are not present', async () => {
    stubSupabaseEnv()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ id: 'auth-user-id' }))
      .mockResolvedValueOnce(
        createJsonResponse([
          {
            id: 'profile-id',
            auth_user_id: 'auth-user-id',
            full_name: 'Consumer User',
            role: 'consumer',
            is_active: true,
            approval_status: 'approved',
          },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await handler(
      {
        method: 'GET',
        headers: {
          authorization: 'Bearer access-token',
        },
      },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.supabase.co/auth/v1/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer access-token',
        }),
      }),
    )
    expect(JSON.parse(response.body)).toMatchObject({
      id: 'profile-id',
      role: 'consumer',
      stations: [],
    })
  })

  it('returns a consumer profile without loading assigned stations', async () => {
    stubSupabaseEnv()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ id: 'auth-user-id' }))
      .mockResolvedValueOnce(
        createJsonResponse([
          {
            id: 'profile-id',
            auth_user_id: 'auth-user-id',
            full_name: 'Consumer User',
            role: 'consumer',
            is_active: true,
            approval_status: 'approved',
          },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await handler(
      {
        method: 'GET',
        headers: {
          cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token',
        },
      },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(response.body)).toMatchObject({
      id: 'profile-id',
      role: 'consumer',
      is_active: true,
      approval_status: 'approved',
      stations: [],
    })
  })

  it('returns a diagnostic error when the auth user has no profile', async () => {
    stubSupabaseEnv()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse({ id: 'auth-user-id' }))
        .mockResolvedValueOnce(createJsonResponse([])),
    )
    const response = createResponse()

    await handler(
      {
        method: 'GET',
        headers: {
          cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token',
        },
      },
      response,
    )

    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.body)).toEqual({ error: 'PROFILE_NOT_FOUND' })
  })

  it('returns a diagnostic error for an unsupported profile role', async () => {
    stubSupabaseEnv()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse({ id: 'auth-user-id' }))
        .mockResolvedValueOnce(
          createJsonResponse([
            {
              id: 'profile-id',
              role: 'legacy_role',
              approval_status: 'approved',
            },
          ]),
        ),
    )
    const response = createResponse()

    await handler(
      {
        method: 'GET',
        headers: {
          cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token',
        },
      },
      response,
    )

    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body)).toEqual({ error: 'INVALID_PROFILE_ROLE' })
  })

  it('returns a timeout diagnostic when Supabase does not respond', async () => {
    stubSupabaseEnv()
    const timeoutError = new Error('The operation was aborted.')

    timeoutError.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(timeoutError))
    const response = createResponse()

    await handler(
      {
        method: 'GET',
        headers: {
          cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token',
        },
      },
      response,
    )

    expect(response.statusCode).toBe(504)
    expect(JSON.parse(response.body)).toEqual({ error: 'Supabase request timed out.' })
  })
})
