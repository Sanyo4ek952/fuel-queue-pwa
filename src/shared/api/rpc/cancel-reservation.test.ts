import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
}))

vi.mock('@/shared/api/auth', () => ({ getAuthSession: mocks.getAuthSession }))
vi.mock('@/shared/config/env', () => ({ isSupabaseConfigured: true }))

import { cancelReservation, parseCancelReservationResult } from './cancel-reservation'

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

describe('parseCancelReservationResult', () => {
  it('parses a valid cancel_reservation response', () => {
    expect(
      parseCancelReservationResult({
        id: 'reservation-id',
        date: '2026-07-09',
        station_id: 'station-id',
        vehicle_id: 'vehicle-id',
        queue_number: 42,
        status: 'CANCELLED',
        sync_status: 'SYNCED',
        cancelled_by: 'profile-id',
        cancelled_at: '2026-07-09T10:00:00.000Z',
        cancel_reason: 'OTHER',
        cancel_comment: 'Дубль',
        updated_at: '2026-07-09T10:00:00.000Z',
      }),
    ).toEqual({
      id: 'reservation-id',
      date: '2026-07-09',
      station_id: 'station-id',
      vehicle_id: 'vehicle-id',
      queue_number: 42,
      status: 'CANCELLED',
      sync_status: 'SYNCED',
      cancelled_by: 'profile-id',
      cancelled_at: '2026-07-09T10:00:00.000Z',
      cancel_reason: 'OTHER',
      cancel_comment: 'Дубль',
      updated_at: '2026-07-09T10:00:00.000Z',
    })
  })

  it('rejects an incomplete cancel_reservation response', () => {
    expect(parseCancelReservationResult({ id: 'reservation-id' })).toBeNull()
  })
})

describe('cancelReservation', () => {
  it('calls the protected API with cancel parameters', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        id: 'reservation-id',
        date: '2026-07-09',
        station_id: 'station-id',
        vehicle_id: 'vehicle-id',
        queue_number: 42,
        status: 'CANCELLED',
        sync_status: 'SYNCED',
        cancelled_by: 'profile-id',
        cancelled_at: '2026-07-09T10:00:00.000Z',
        cancel_reason: 'OTHER',
        cancel_comment: 'Duplicate',
        updated_at: '2026-07-09T10:00:00.000Z',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await cancelReservation({
      reservationId: 'reservation-id',
      reason: 'OTHER',
      comment: 'Duplicate',
      clientMutationId: 'mutation-id',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cancel-reservation',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        body: JSON.stringify({
          reservationId: 'reservation-id',
          reason: 'OTHER',
          comment: 'Duplicate',
          clientMutationId: 'mutation-id',
        }),
      }),
    )
    expect(result.data).toMatchObject({
      id: 'reservation-id',
      status: 'CANCELLED',
    })
    expect(result.error).toBeNull()
  })

  it('returns the protected API error message', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createJsonResponse({ error: 'FORBIDDEN' }, 403)))

    const result = await cancelReservation({
      reservationId: 'reservation-id',
      reason: 'OWNER_CANCELLED',
      comment: null,
      clientMutationId: 'mutation-id',
    })

    expect(result).toEqual({
      data: null,
      error: 'FORBIDDEN',
    })
  })
})
