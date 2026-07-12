import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cleanupUnconfirmedUsers,
  type CleanupUnconfirmedUsersEnv,
} from '../../../../api/cron/_lib/cleanup-unconfirmed-users.js'

const env: CleanupUnconfirmedUsersEnv = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseServiceRoleKey: 'service-role-key',
}

function createJsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function createUser({
  id,
  createdAt,
  emailConfirmedAt,
}: {
  id: string
  createdAt: string
  emailConfirmedAt: string | null
}) {
  return {
    id,
    created_at: createdAt,
    email_confirmed_at: emailConfirmedAt,
  }
}

describe('cleanupUnconfirmedUsers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deletes only unconfirmed users older than 24 hours', async () => {
    const oldUnconfirmed = createUser({
      id: 'old-unconfirmed',
      createdAt: '2026-07-09T08:59:59.000Z',
      emailConfirmedAt: null,
    })
    const oldConfirmed = createUser({
      id: 'old-confirmed',
      createdAt: '2026-07-08T09:00:00.000Z',
      emailConfirmedAt: '2026-07-08T09:05:00.000Z',
    })
    const freshUnconfirmed = createUser({
      id: 'fresh-unconfirmed',
      createdAt: '2026-07-09T09:00:00.000Z',
      emailConfirmedAt: null,
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          users: [oldUnconfirmed, oldConfirmed, freshUnconfirmed],
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({}))

    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupUnconfirmedUsers({
      env,
      now: new Date('2026-07-10T09:00:00.000Z'),
    })

    expect(result).toEqual({
      scannedCount: 3,
      deletedCount: 1,
      cutoffIso: '2026-07-09T09:00:00.000Z',
      deletedUserIds: ['old-unconfirmed'],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.supabase.co/auth/v1/admin/users/old-unconfirmed',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('does not delete confirmed users', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createJsonResponse({
        users: [
          createUser({
            id: 'confirmed',
            createdAt: '2026-07-08T09:00:00.000Z',
            emailConfirmedAt: '2026-07-08T09:01:00.000Z',
          }),
        ],
      }),
    )

    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupUnconfirmedUsers({
      env,
      now: new Date('2026-07-10T09:00:00.000Z'),
    })

    expect(result.deletedCount).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not delete fresh unconfirmed users', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createJsonResponse({
        users: [
          createUser({
            id: 'fresh',
            createdAt: '2026-07-09T09:00:00.000Z',
            emailConfirmedAt: null,
          }),
        ],
      }),
    )

    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupUnconfirmedUsers({
      env,
      now: new Date('2026-07-10T09:00:00.000Z'),
    })

    expect(result.deletedCount).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('paginates users and returns scanned and deleted counters', async () => {
    const firstPageUsers = Array.from({ length: 1000 }, (_, index) =>
      createUser({
        id: `page-1-user-${index}`,
        createdAt: '2026-07-10T08:00:00.000Z',
        emailConfirmedAt: null,
      }),
    )
    const oldUnconfirmed = createUser({
      id: 'page-2-old-unconfirmed',
      createdAt: '2026-07-09T08:00:00.000Z',
      emailConfirmedAt: null,
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ users: firstPageUsers }))
      .mockResolvedValueOnce(createJsonResponse({ users: [oldUnconfirmed] }))
      .mockResolvedValueOnce(createJsonResponse({}))

    vi.stubGlobal('fetch', fetchMock)

    const result = await cleanupUnconfirmedUsers({
      env,
      now: new Date('2026-07-10T09:00:00.000Z'),
    })

    expect(result.scannedCount).toBe(1001)
    expect(result.deletedCount).toBe(1)
    expect(result.deletedUserIds).toEqual(['page-2-old-unconfirmed'])
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.supabase.co/auth/v1/admin/users?page=1&per_page=1000',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.supabase.co/auth/v1/admin/users?page=2&per_page=1000',
      expect.any(Object),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://example.supabase.co/auth/v1/admin/users/page-2-old-unconfirmed',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
