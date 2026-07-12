import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
}))

vi.mock('@/shared/api/auth', () => ({ getAuthSession: mocks.getAuthSession }))
vi.mock('@/shared/config/env', () => ({ isSupabaseConfigured: true }))

import { syncOfflineMutation } from './sync-offline-mutation'

function createJsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('syncOfflineMutation', () => {
  it('calls the protected API with outbox operation parameters', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        status: 'SYNCED',
        operation_type: 'CREATE_ALLOCATION_CALL_LOG',
        client_mutation_id: 'mutation-id',
        data: { id: 'call-id' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await syncOfflineMutation({
      clientMutationId: 'mutation-id',
      operationType: 'CREATE_ALLOCATION_CALL_LOG',
      payload: { allocation_id: 'allocation-id', status: 'CONTACTED' },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sync-offline-mutation',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        body: JSON.stringify({
          clientMutationId: 'mutation-id',
          operationType: 'CREATE_ALLOCATION_CALL_LOG',
          payload: { allocation_id: 'allocation-id', status: 'CONTACTED' },
        }),
      }),
    )
    expect(result).toMatchObject({
      data: {
        status: 'SYNCED',
        operation_type: 'CREATE_ALLOCATION_CALL_LOG',
        client_mutation_id: 'mutation-id',
      },
      error: null,
    })
  })

  it('returns conflict responses without treating them as request errors', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createJsonResponse({
          status: 'CONFLICT',
          operation_type: 'CREATE_FUELING_RECORD',
          client_mutation_id: 'mutation-id',
          reason: 'ALREADY_FUELED',
          payload: { vehicle_id: 'vehicle-id' },
        }),
      ),
    )

    await expect(
      syncOfflineMutation({
        clientMutationId: 'mutation-id',
        operationType: 'CREATE_FUELING_RECORD',
        payload: { vehicle_id: 'vehicle-id' },
      }),
    ).resolves.toMatchObject({
      data: {
        status: 'CONFLICT',
        reason: 'ALREADY_FUELED',
      },
      error: null,
    })
  })

  it('returns protected API errors', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createJsonResponse({ error: 'Sync failed.' }, 500)),
    )

    const result = await syncOfflineMutation({
      clientMutationId: 'mutation-id',
      operationType: 'CREATE_FUELING_RECORD',
      payload: {},
    })

    expect(result).toEqual({
      data: null,
      error: 'Sync failed.',
    })
  })
})
