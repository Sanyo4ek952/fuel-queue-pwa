import { afterEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../api/cron-runner.js'
import { cleanupUnconfirmedUsers } from '../../../api/cron/_lib/cleanup-unconfirmed-users.js'

vi.mock('../../../api/cron/_lib/cleanup-unconfirmed-users.js', () => ({
  cleanupUnconfirmedUsers: vi.fn(),
}))

function createResponse() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader: vi.fn((key: string, value: string) => {
      response.headers[key.toLowerCase()] = value
      return response
    }),
    status: vi.fn((statusCode: number) => {
      response.statusCode = statusCode
      return {
        json: vi.fn((value: unknown) => {
          response.body = value
        }),
      }
    }),
  }

  return response
}

function stubCronEnv() {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
  vi.stubEnv('CRON_SECRET', 'cron-secret')
}

describe('/api/cron/cleanup-unconfirmed-users', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('rejects CRON_SECRET passed as a query parameter', async () => {
    stubCronEnv()
    const response = createResponse()

    await handler(
      {
        method: 'GET',
        headers: {},
        query: { job: 'cleanup-unconfirmed-users', secret: 'cron-secret' },
      },
      response,
    )

    expect(response.statusCode).toBe(401)
    expect(response.body).toEqual({ error: 'Unauthorized.' })
    expect(cleanupUnconfirmedUsers).not.toHaveBeenCalled()
  })

  it('rejects missing or invalid bearer credentials', async () => {
    stubCronEnv()
    const response = createResponse()

    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer wrong-secret' },
        query: { job: 'cleanup-unconfirmed-users' },
      },
      response,
    )

    expect(response.statusCode).toBe(401)
    expect(response.body).toEqual({ error: 'Unauthorized.' })
    expect(cleanupUnconfirmedUsers).not.toHaveBeenCalled()
  })

  it('accepts Authorization Bearer CRON_SECRET', async () => {
    stubCronEnv()
    vi.mocked(cleanupUnconfirmedUsers).mockResolvedValueOnce({
      scannedCount: 3,
      deletedCount: 1,
      cutoffIso: '2026-07-09T09:00:00.000Z',
      deletedUserIds: ['old-unconfirmed'],
    })
    const response = createResponse()

    await handler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer cron-secret' },
        query: { job: 'cleanup-unconfirmed-users' },
      },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({
      ok: true,
      cutoffIso: '2026-07-09T09:00:00.000Z',
      scannedCount: 3,
      deletedCount: 1,
    })
    expect(cleanupUnconfirmedUsers).toHaveBeenCalledWith({
      env: expect.objectContaining({
        supabaseUrl: 'https://example.supabase.co',
        supabaseServiceRoleKey: 'service-role-key',
      }),
    })
  })
})
