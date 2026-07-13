import { afterEach, describe, expect, it, vi } from 'vitest'

import protectedRpcHandler from '../../api/protected-rpc.js'

type TestResponse = {
  statusCode: number
  headers: Record<string, string | string[]>
  body: string
  status: (statusCode: number) => TestResponse
  setHeader: (key: string, value: string | string[]) => TestResponse
  end: (body: string) => TestResponse
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

describe('protected queue action API proxy endpoints', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('requires an authorization token', async () => {
    stubSupabaseEnv()
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'reservation-call-log' },
        body: {},
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(401)
    expect(JSON.parse(response.body)).toEqual({ error: 'Authorization token is required.' })
  })

  it('/api/reservation-call-log proxies create_reservation_call_log', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ id: 'call-id' }))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token' },
        query: { action: 'reservation-call-log' },
        body: {
          allocationId: 'allocation-id',
          status: 'CONTACTED',
          comment: 'ok',
          clientMutationId: 'mutation-id',
        },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Record<string, string>

    expect(response.statusCode).toBe(200)
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/create_reservation_call_log')
    expect(headers.apikey).toBe('anon-key')
    expect(headers.authorization).toBe('Bearer access-token')
    expect(JSON.parse(init.body as string)).toEqual({
      reservation_id: 'allocation-id',
      status: 'CONTACTED',
      comment: 'ok',
      client_mutation_id: 'mutation-id',
    })
  })

  it('/api/create-reservation proxies create_reservation', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ id: 'reservation-id' }))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token' },
        query: { action: 'create-reservation' },
        body: {
          plateNumber: 'А222АА222',
          driverFullName: 'Driver',
          driverPhone: '+77998789798',
          fuelType: 'AI_95',
          fuelPreferenceMode: 'EXACT',
          requestedLiters: 20,
          comment: 'ok',
          clientMutationId: 'mutation-id',
        },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]

    expect(response.statusCode).toBe(200)
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/create_reservation')
    expect(JSON.parse(init.body as string)).toEqual({
      plate_number: 'А222АА222',
      driver_full_name: 'Driver',
      driver_phone: '+77998789798',
      fuel_type: 'AI_95',
      fuel_preference_mode: 'EXACT',
      requested_liters: 20,
      comment: 'ok',
      client_mutation_id: 'mutation-id',
    })
  })

  it('/api/update-reservation-fuel-preference proxies update_reservation_fuel_preference', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ id: 'reservation-id' }))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token' },
        query: { action: 'update-reservation-fuel-preference' },
        body: {
          reservationId: 'reservation-id',
          fuelType: 'AI_92',
          fuelPreferenceMode: 'ANY_GASOLINE',
          clientMutationId: 'mutation-id',
        },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]

    expect(response.statusCode).toBe(200)
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/update_reservation_fuel_preference')
    expect(JSON.parse(init.body as string)).toEqual({
      reservation_id: 'reservation-id',
      fuel_type: 'AI_92',
      fuel_preference_mode: 'ANY_GASOLINE',
      client_mutation_id: 'mutation-id',
    })
  })

  it('/api/cancel-reservation proxies cancel_reservation', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ id: 'reservation-id' }))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token' },
        query: { action: 'cancel-reservation' },
        body: {
          reservationId: 'reservation-id',
          reason: 'OTHER',
          comment: 'Duplicate',
          clientMutationId: 'mutation-id',
        },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]

    expect(response.statusCode).toBe(200)
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/cancel_reservation')
    expect(JSON.parse(init.body as string)).toEqual({
      reservation_id: 'reservation-id',
      reason: 'OTHER',
      comment: 'Duplicate',
      client_mutation_id: 'mutation-id',
    })
  })

  it('/api/sync-offline-mutation proxies sync_offline_mutation', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ status: 'SYNCED' }))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token' },
        query: { action: 'sync-offline-mutation' },
        body: {
          clientMutationId: 'mutation-id',
          operationType: 'CREATE_ALLOCATION_CALL_LOG',
          payload: { allocation_id: 'allocation-id', status: 'CONTACTED' },
        },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]

    expect(response.statusCode).toBe(200)
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/sync_offline_mutation')
    expect(JSON.parse(init.body as string)).toEqual({
      client_mutation_id: 'mutation-id',
      operation_type: 'CREATE_ALLOCATION_CALL_LOG',
      payload: { allocation_id: 'allocation-id', status: 'CONTACTED' },
    })
  })

  it('proxies Supabase errors', async () => {
    stubSupabaseEnv()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createJsonResponse({ message: 'FORBIDDEN' }, 403)),
    )
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token' },
        query: { action: 'cancel-reservation' },
        body: {},
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(403)
    expect(JSON.parse(response.body)).toEqual({ error: 'FORBIDDEN' })
  })

  it('refreshes the session and retries once when Supabase rejects the access token', async () => {
    stubSupabaseEnv()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ message: 'JWT expired' }, 401))
      .mockResolvedValueOnce(
        createJsonResponse({
          access_token: 'refreshed-access-token',
          refresh_token: 'refreshed-refresh-token',
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ id: 'reservation-id' }))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { cookie: 'azs_sb_access=stale-access-token; azs_sb_refresh=refresh-token' },
        query: { action: 'create-reservation' },
        body: { clientMutationId: 'mutation-id' },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refresh_token: 'refresh-token' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://example.supabase.co/rest/v1/rpc/create_reservation',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer refreshed-access-token',
        }),
      }),
    )
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('azs_sb_access=refreshed-access-token'),
        expect.stringContaining('azs_sb_refresh=refreshed-refresh-token'),
      ]),
    )
  })

  it('returns 401 when the retry refresh fails', async () => {
    stubSupabaseEnv()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ message: 'JWT expired' }, 401))
      .mockResolvedValueOnce(createJsonResponse({ error: 'invalid refresh token' }, 400))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { cookie: 'azs_sb_access=stale-access-token; azs_sb_refresh=refresh-token' },
        query: { action: 'create-reservation' },
        body: {},
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(401)
    expect(JSON.parse(response.body)).toEqual({ error: 'invalid refresh token' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns 504 when Supabase times out', async () => {
    stubSupabaseEnv()
    const timeoutError = new Error('The operation was aborted.')

    timeoutError.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError))
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token' },
        query: { action: 'sync-offline-mutation' },
        body: {},
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(504)
    expect(JSON.parse(response.body)).toEqual({ error: 'Supabase request timed out.' })
  })
})
