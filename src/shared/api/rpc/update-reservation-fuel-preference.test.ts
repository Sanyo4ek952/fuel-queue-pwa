import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

import { supabase } from '@/shared/api/supabase'

import {
  parseUpdateReservationFuelPreferenceResult,
  updateReservationFuelPreference,
} from './update-reservation-fuel-preference'

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
  it('calls the RPC with reservation fuel preference parameters', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
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
      },
      error: null,
    } as never)

    const result = await updateReservationFuelPreference({
      reservationId: 'reservation-id',
      fuelType: 'AI_100',
      fuelPreferenceMode: 'EXACT',
      clientMutationId: 'mutation-id',
    })

    expect(supabase.rpc).toHaveBeenCalledWith('update_reservation_fuel_preference', {
      reservation_id: 'reservation-id',
      fuel_type: 'AI_100',
      fuel_preference_mode: 'EXACT',
      client_mutation_id: 'mutation-id',
    })
    expect(result.data).toMatchObject({
      id: 'reservation-id',
      fuel_type: 'AI_100',
    })
    expect(result.error).toBeNull()
  })

  it('returns the RPC error message', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: { message: 'RESERVATION_NOT_ACTIVE' },
    } as never)

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
})
