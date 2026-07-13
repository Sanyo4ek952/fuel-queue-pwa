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

async function callProtectedUsersAction(action: string, body: Record<string, unknown>) {
  stubSupabaseEnv()
  const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(null))
  vi.stubGlobal('fetch', fetchMock)
  const response = createResponse()

  await protectedRpcHandler(
    {
      method: 'POST',
      headers: { cookie: 'azs_sb_access=access-token; azs_sb_refresh=refresh-token' },
      query: { action },
      body,
      [Symbol.asyncIterator]: async function* () {},
    },
    response,
  )

  const [url, init] = fetchMock.mock.calls[0]
  const headers = init.headers as Record<string, string>

  expect(response.statusCode).toBe(200)
  expect(headers.apikey).toBe('anon-key')
  expect(headers.authorization).toBe('Bearer access-token')

  return {
    url,
    body: JSON.parse(init.body as string),
  }
}

describe('protected users API proxy endpoints', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('/api/list-managed-profiles proxies list_managed_profiles_page', async () => {
    const result = await callProtectedUsersAction('list-managed-profiles', {
      section: 'active',
      limit: 10,
      offset: 20,
    })

    expect(result.url).toBe('https://example.supabase.co/rest/v1/rpc/list_managed_profiles_page')
    expect(result.body).toEqual({
      section: 'active',
      page_limit: 10,
      page_offset: 20,
    })
  })

  it('/api/approve-registration proxies approve_registration', async () => {
    const result = await callProtectedUsersAction('approve-registration', {
      profileId: 'profile-id',
      role: 'cashier',
      stationIds: ['station-1', 'station-2'],
    })

    expect(result.url).toBe('https://example.supabase.co/rest/v1/rpc/approve_registration')
    expect(result.body).toEqual({
      target_profile_id: 'profile-id',
      target_role: 'cashier',
      target_station_ids: ['station-1', 'station-2'],
    })
  })

  it('/api/reject-registration proxies reject_registration', async () => {
    const result = await callProtectedUsersAction('reject-registration', {
      profileId: 'profile-id',
      reason: 'Missing documents',
    })

    expect(result.url).toBe('https://example.supabase.co/rest/v1/rpc/reject_registration')
    expect(result.body).toEqual({
      target_profile_id: 'profile-id',
      reason: 'Missing documents',
    })
  })

  it('/api/deactivate-profile proxies deactivate_profile', async () => {
    const result = await callProtectedUsersAction('deactivate-profile', {
      profileId: 'profile-id',
      reason: 'No longer employed',
    })

    expect(result.url).toBe('https://example.supabase.co/rest/v1/rpc/deactivate_profile')
    expect(result.body).toEqual({
      target_profile_id: 'profile-id',
      reason: 'No longer employed',
    })
  })

  it('/api/list-my-vehicles proxies list_my_vehicles', async () => {
    const result = await callProtectedUsersAction('list-my-vehicles', {})

    expect(result.url).toBe('https://example.supabase.co/rest/v1/rpc/list_my_vehicles')
    expect(result.body).toEqual({})
  })

  it('/api/get-my-queue-status proxies get_my_queue_status', async () => {
    const result = await callProtectedUsersAction('get-my-queue-status', {})

    expect(result.url).toBe('https://example.supabase.co/rest/v1/rpc/get_my_queue_status')
    expect(result.body).toEqual({})
  })

  it('/api/get-my-today-fueling-status proxies get_my_today_fueling_status', async () => {
    const result = await callProtectedUsersAction('get-my-today-fueling-status', {})

    expect(result.url).toBe('https://example.supabase.co/rest/v1/rpc/get_my_today_fueling_status')
    expect(result.body).toEqual({})
  })
})
