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

describe('protected queue API proxy endpoints', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('/api/today-queue requires an authorization token', async () => {
    stubSupabaseEnv()
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: {},
        query: { action: 'today-queue' },
        body: {},
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(401)
    expect(JSON.parse(response.body)).toEqual({ error: 'Authorization token is required.' })
  })

  it('/api/today-queue proxies get_today_call_list with the user bearer token', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        rows: [],
        next_cursor: null,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token' },
        query: { action: 'today-queue' },
        body: {
          targetDate: '2026-07-12',
          pageSize: 25,
          cursor: { queue_number: 10, id: 'cursor-id' },
          plateSearch: 'A123BC777',
          createdByProfileId: 'profile-id',
          callFilter: 'call',
          gasolineFuelFilter: 'AI_95',
          fuelCategoryFilter: 'GASOLINE',
        },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Record<string, string>

    expect(response.statusCode).toBe(200)
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/get_today_call_list')
    expect(headers.apikey).toBe('anon-key')
    expect(headers.authorization).toBe('Bearer access-token')
    expect(JSON.parse(init.body as string)).toEqual({
      target_date: '2026-07-12',
      page_size: 25,
      cursor_queue_number: 10,
      cursor_id: 'cursor-id',
      plate_search: 'A123BC777',
      created_by_profile_id: 'profile-id',
      call_filter: 'call',
      gasoline_fuel_filter: 'AI_95',
      fuel_category_filter: 'GASOLINE',
    })
  })

  it('/api/today-queue-authors proxies get_today_queue_authors filters', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token' },
        query: { action: 'today-queue-authors' },
        body: {
          targetDate: '2026-07-12',
          plateSearch: 'A123BC777',
          callFilter: 'no_answer',
          gasolineFuelFilter: 'AI_92',
        },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]

    expect(response.statusCode).toBe(200)
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/get_today_queue_authors')
    expect(JSON.parse(init.body as string)).toEqual({
      target_date: '2026-07-12',
      plate_search: 'A123BC777',
      call_filter: 'no_answer',
      gasoline_fuel_filter: 'AI_92',
    })
  })

  it('/api/daily-limit-overview proxies get_daily_limit_overview', async () => {
    stubSupabaseEnv()
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        exists: false,
        date: '2026-07-12',
        category_overviews: [],
        station_overviews: [],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await protectedRpcHandler(
      {
        method: 'POST',
        headers: { cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token' },
        query: { action: 'daily-limit-overview' },
        body: { date: '2026-07-12' },
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    const [url, init] = fetchMock.mock.calls[0]

    expect(response.statusCode).toBe(200)
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/get_daily_limit_overview')
    expect(JSON.parse(init.body as string)).toEqual({ target_date: '2026-07-12' })
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
        query: { action: 'today-queue' },
        body: {},
        [Symbol.asyncIterator]: async function* () {},
      },
      response,
    )

    expect(response.statusCode).toBe(504)
    expect(JSON.parse(response.body)).toEqual({ error: 'Supabase request timed out.' })
  })
})
