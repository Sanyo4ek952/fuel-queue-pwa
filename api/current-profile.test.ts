import { afterEach, describe, expect, it, vi } from 'vitest'

import handler from './current-profile.js'

function createResponse() {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    status: vi.fn((statusCode: number) => {
      response.statusCode = statusCode
      return response
    }),
    setHeader: vi.fn((key: string, value: string) => {
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

describe('/api/current-profile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('requires an authorization token', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key')
    const response = createResponse()

    await handler({ method: 'GET', headers: {} }, response)

    expect(response.statusCode).toBe(401)
    expect(JSON.parse(response.body)).toEqual({ error: 'Authorization token is required.' })
  })

  it('returns the current profile with assigned stations', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'auth-user-id' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                id: 'profile-id',
                auth_user_id: 'auth-user-id',
                full_name: 'Test User',
                role: 'cashier',
                is_active: true,
                approval_status: 'approved',
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                stations: {
                  id: 'station-id',
                  name: 'AZS #1',
                  address: null,
                },
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        ),
    )
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
    expect(JSON.parse(response.body)).toMatchObject({
      id: 'profile-id',
      stations: [{ id: 'station-id', name: 'AZS #1', address: null }],
    })
  })
})
