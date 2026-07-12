import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
}))

vi.mock('@/shared/api/auth', () => ({ getAuthSession: mocks.getAuthSession }))
vi.mock('@/shared/config/env', () => ({ isSupabaseConfigured: true }))

import {
  parseUpdateReservationFuelPreferenceResult,
  updateReservationFuelPreference,
} from './update-reservation-fuel-preference'

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

describe('parseUpdateReservationFuelPreferenceResult', () => {
  it('parses a valid update_reservation_fuel_preference response', () => {
    expect(
      parseUpdateReservationFuelPreferenceResult({
        id: 'reservation-id',
        date: '2026-07-08',
        station_id: 'station-id',
        vehicle_id: 'vehicle-id',
        fuel_type: 'AI_92',
        fuel_preference_mode: 'ANY_GASOLINE',
        queue_number: '7',
        status: 'RESERVED',
        client_mutation_id: 'mutation-id',
        sync_status: 'SYNCED',
        updated_at: '2026-07-08T10:00:00.000Z',
      }),
    ).toMatchObject({
      id: 'reservation-id',
      fuel_type: 'AI_92',
      fuel_preference_mode: 'ANY_GASOLINE',
      queue_number: 7,
      status: 'RESERVED',
    })
  })

  it('returns null for an unexpected response', () => {
    expect(parseUpdateReservationFuelPreferenceResult({ id: 'reservation-id' })).toBeNull()
  })
})

describe('updateReservationFuelPreference', () => {
  it('calls the protected API with reservation fuel preference parameters', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        id: 'reservation-id',
        date: '2026-07-08',
        station_id: 'station-id',
        vehicle_id: 'vehicle-id',
        fuel_type: 'AI_100',
        fuel_preference_mode: 'EXACT',
        queue_number: 3,
        status: 'RESERVED',
        client_mutation_id: 'mutation-id',
        sync_status: 'SYNCED',
        updated_at: '2026-07-08T10:00:00.000Z',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await updateReservationFuelPreference({
      reservationId: 'reservation-id',
      fuelType: 'AI_100',
      fuelPreferenceMode: 'EXACT',
      clientMutationId: 'mutation-id',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/update-reservation-fuel-preference',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        body: JSON.stringify({
          reservationId: 'reservation-id',
          fuelType: 'AI_100',
          fuelPreferenceMode: 'EXACT',
          clientMutationId: 'mutation-id',
        }),
      }),
    )
    expect(result.data).toMatchObject({
      id: 'reservation-id',
      fuel_type: 'AI_100',
    })
    expect(result.error).toBeNull()
  })

  it('returns the protected API error message', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createJsonResponse({ error: 'RESERVATION_NOT_ACTIVE' }, 409)))

    const result = await updateReservationFuelPreference({
      reservationId: 'reservation-id',
      fuelType: 'AI_95',
      fuelPreferenceMode: 'EXACT',
      clientMutationId: 'mutation-id',
    })

    expect(result).toEqual({
      data: null,
      error: 'RESERVATION_NOT_ACTIVE',
    })
  })

  it('returns the open limit lock error from the protected API', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createJsonResponse({ error: 'FUEL_PREFERENCE_LOCKED_BY_OPEN_LIMIT' }, 409),
      ),
    )

    const result = await updateReservationFuelPreference({
      reservationId: 'reservation-id',
      fuelType: 'AI_92',
      fuelPreferenceMode: 'EXACT',
      clientMutationId: 'mutation-id',
    })

    expect(result).toEqual({
      data: null,
      error: 'FUEL_PREFERENCE_LOCKED_BY_OPEN_LIMIT',
    })
  })
})
