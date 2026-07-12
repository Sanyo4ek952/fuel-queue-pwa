import { afterEach, describe, expect, it, vi } from 'vitest'

import handler from '../../../api/cron/backup-queue.js'
import { runQueueBackup } from '../../../api/cron/_lib/run-queue-backup.js'

vi.mock('../../../api/cron/_lib/run-queue-backup.js', () => ({
  runQueueBackup: vi.fn(),
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
  vi.stubEnv('GOOGLE_DRIVE_FOLDER_ID', 'drive-folder-id')
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', 'backup@example.local')
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'private-key')
}

describe('/api/cron/backup-queue', () => {
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
        query: { secret: 'cron-secret' },
      },
      response,
    )

    expect(response.statusCode).toBe(401)
    expect(response.body).toEqual({ error: 'Unauthorized.' })
    expect(runQueueBackup).not.toHaveBeenCalled()
  })

  it('rejects missing or invalid bearer credentials', async () => {
    stubCronEnv()
    const response = createResponse()

    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer wrong-secret' },
        query: {},
      },
      response,
    )

    expect(response.statusCode).toBe(401)
    expect(response.body).toEqual({ error: 'Unauthorized.' })
    expect(runQueueBackup).not.toHaveBeenCalled()
  })

  it('accepts Authorization Bearer CRON_SECRET', async () => {
    stubCronEnv()
    vi.mocked(runQueueBackup).mockResolvedValueOnce({
      targetDate: '2026-07-09',
      csv: 'csv',
      file: {
        id: 'file-id',
        name: 'azs-queue-backup-2026-07-09.csv',
      },
      fileName: 'azs-queue-backup-2026-07-09.csv',
      rowsCount: 2,
      deletedOldFilesCount: 1,
    })
    const response = createResponse()

    await handler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer cron-secret' },
        query: { date: '2026-07-09' },
      },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      ok: true,
      targetDate: '2026-07-09',
      rowsCount: 2,
      deletedOldFilesCount: 1,
    })
    expect(runQueueBackup).toHaveBeenCalledWith({
      env: expect.objectContaining({ cronSecret: 'cron-secret' }),
      targetDate: '2026-07-09',
    })
  })
})
