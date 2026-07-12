import { afterEach, describe, expect, it, vi } from 'vitest'

import protectedRpcHandler from '../../api/protected-rpc.js'

type TestResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string
  status: (statusCode: number) => TestResponse
  setHeader: (key: string, value: string) => TestResponse
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

describe('protected fueling API proxy endpoints', () => {
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
        query: { action: 'check-vehicle-access' },
        body: {},
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(401)
    expect(JSON.parse(response.body)).toEqual({ error: 'Authorization token is required.' })
  })

  it('rejects an unknown protected RPC action', async () => {
    stubSupabaseEnv()
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer access-token' },
        query: { action: 'unknown-action' },
        body: {},
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.body)).toEqual({ error: 'Protected RPC action not found.' })
  })

  it('/api/check-vehicle-access proxies check_vehicle_access', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ status: 'ALLOWED' }))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer access-token' },
        query: { action: 'check-vehicle-access' },
        body: {
          plateNumber: 'A123BC777',
          stationId: 'station-id',
          checkDate: '2026-07-12',
        },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Record<string, string>

    expect(response.statusCode).toBe(200)
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/check_vehicle_access')
    expect(headers.apikey).toBe('anon-key')
    expect(headers.authorization).toBe('Bearer access-token')
    expect(JSON.parse(init.body as string)).toEqual({
      plate_number: 'A123BC777',
      station_id: 'station-id',
      check_date: '2026-07-12',
    })
  })

  it('/api/vehicle-fueling-history proxies get_vehicle_fueling_history', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ records: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer access-token' },
        query: { action: 'vehicle-fueling-history' },
        body: {
          plateNumber: 'A123BC777',
          pageLimit: 10,
          pageOffset: 20,
        },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]

    expect(response.statusCode).toBe(200)
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/get_vehicle_fueling_history')
    expect(JSON.parse(init.body as string)).toEqual({
      plate_number: 'A123BC777',
      page_limit: 10,
      page_offset: 20,
    })
  })

  it('/api/vehicle-recent-fueling-history proxies get_vehicle_recent_fueling_history', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ records: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer access-token' },
        query: { action: 'vehicle-recent-fueling-history' },
        body: { plateNumber: 'A123BC777' },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]

    expect(response.statusCode).toBe(200)
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/get_vehicle_recent_fueling_history')
    expect(JSON.parse(init.body as string)).toEqual({ plate_number: 'A123BC777' })
  })

  it('/api/create-fueling-record-for-allocation proxies create_fueling_record_for_allocation', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ id: 'fueling-id' }))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer access-token' },
        query: { action: 'create-fueling-record-for-allocation' },
        body: {
          allocationId: 'allocation-id',
          liters: 20,
          fueledAt: '2026-07-12T10:00:00.000Z',
          comment: 'ok',
          clientMutationId: 'mutation-id',
        },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]

    expect(response.statusCode).toBe(200)
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/create_fueling_record_for_allocation')
    expect(JSON.parse(init.body as string)).toEqual({
      allocation_id: 'allocation-id',
      liters: 20,
      fueled_at: '2026-07-12T10:00:00.000Z',
      comment: 'ok',
      client_mutation_id: 'mutation-id',
    })
  })

  it('/api/create-fueling-record-for-preferential-entry proxies create_fueling_record_for_preferential_entry', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ id: 'fueling-id' }))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer access-token' },
        query: { action: 'create-fueling-record-for-preferential-entry' },
        body: {
          preferentialQueueEntryId: 'preferential-entry-id',
          stationId: 'station-id',
          liters: 15,
          fueledAt: '2026-07-12T10:00:00.000Z',
          comment: null,
          clientMutationId: 'mutation-id',
        },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]

    expect(response.statusCode).toBe(200)
    expect(url).toBe(
      'https://example.supabase.co/rest/v1/rpc/create_fueling_record_for_preferential_entry',
    )
    expect(JSON.parse(init.body as string)).toEqual({
      preferential_queue_entry_id: 'preferential-entry-id',
      station_id: 'station-id',
      liters: 15,
      fueled_at: '2026-07-12T10:00:00.000Z',
      comment: null,
      client_mutation_id: 'mutation-id',
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
        headers: { authorization: 'Bearer access-token' },
        query: { action: 'create-fueling-record-for-allocation' },
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
        headers: { authorization: 'Bearer access-token' },
        query: { action: 'vehicle-fueling-history' },
        body: {},
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(504)
    expect(JSON.parse(response.body)).toEqual({ error: 'Supabase request timed out.' })
  })
})
