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
