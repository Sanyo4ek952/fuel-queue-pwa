import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/fetch-with-timeout', () => ({
  fetchWithTimeout: vi.fn(),
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

import { fetchWithTimeout } from '@/shared/lib/fetch-with-timeout'

import {
  createConsumerReservation,
  parseCancelMyReservationResult,
  parseConsumerReservation,
  parseConsumerTodayFuelingStatus,
  parseConsumerVehicle,
} from './consumer-cabinet'

afterEach(() => {
  vi.clearAllMocks()
})

describe('consumer cabinet RPC parsers', () => {
  it('parses a consumer vehicle response', () => {
    expect(
      parseConsumerVehicle({
        id: 'vehicle-id',
        profile_vehicle_id: 'profile-vehicle-id',
        plate_number: 'A123BC777',
        normalized_plate_number: 'A123BC777',
        is_blocked: false,
        block_reason: null,
        status: 'ACTIVE',
        created_at: '2026-07-09T10:00:00Z',
        updated_at: '2026-07-09T10:00:00Z',
      }),
    ).toMatchObject({
      id: 'vehicle-id',
      profile_vehicle_id: 'profile-vehicle-id',
      status: 'ACTIVE',
    })
  })

  it('parses a consumer reservation response with allocation details', () => {
    expect(
      parseConsumerReservation({
        id: 'reservation-id',
        vehicle_id: 'vehicle-id',
        fuel_type: 'AI_95',
        fuel_preference_mode: 'EXACT',
        requested_liters: '20',
        permanent_number: '7',
        queue_number: '7',
        status: 'WAITING',
        client_mutation_id: 'mutation-id',
        allocation: {
          id: 'allocation-id',
          date: '2026-07-10',
          station_id: 'station-id',
          assigned_fuel_type: 'AI_95',
          daily_position: '3',
          station_position: '2',
          station_fuel_position: '1',
          arrival_at: '2026-07-10T10:00:00Z',
          status: 'ACTIVE',
          call_status: 'NOT_CALLED',
        },
      }),
    ).toMatchObject({
      id: 'reservation-id',
      permanent_number: 7,
      allocation: {
        id: 'allocation-id',
        daily_position: 3,
      },
    })
  })

  it('parses today fueling status and cancellation responses', () => {
    expect(
      parseConsumerTodayFuelingStatus({
        id: 'fueling-id',
        date: '2026-07-10',
        station_id: 'station-id',
        vehicle_id: 'vehicle-id',
        fuel_type: 'AI_95',
        fueled_at: '2026-07-10T10:00:00Z',
        ticket_number: '7',
      }),
    ).toMatchObject({ id: 'fueling-id', ticket_number: 7 })

    expect(
      parseCancelMyReservationResult({
        id: 'reservation-id',
        vehicle_id: 'vehicle-id',
        queue_number: '7',
        status: 'CANCELLED',
        sync_status: 'SYNCED',
        cancelled_by: 'profile-id',
        cancelled_at: '2026-07-10T10:00:00Z',
        cancel_reason: 'CONSUMER_REQUEST',
        updated_at: '2026-07-10T10:00:00Z',
      }),
    ).toMatchObject({ id: 'reservation-id', queue_number: 7 })
  })
})

describe('createConsumerReservation', () => {
  it('sends only the compatibility requested liters placeholder through the BFF', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'reservation-id',
          vehicle_id: 'vehicle-id',
          fuel_type: 'AI_95',
          fuel_preference_mode: 'EXACT',
          requested_liters: 25,
          permanent_number: 7,
          queue_number: 7,
          status: 'WAITING',
          client_mutation_id: 'mutation-id',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ) as never,
    )

    await expect(
      createConsumerReservation({
        vehicleId: 'vehicle-id',
        driverFullName: 'Ivan Ivanov',
        driverPhone: '+79991234567',
        fuelType: 'AI_95',
        fuelPreferenceMode: 'EXACT',
        comment: '',
        clientMutationId: 'mutation-id',
      }),
    ).resolves.toMatchObject({
      data: {
        requested_liters: 25,
      },
      error: null,
    })

    const [path, init] = vi.mocked(fetchWithTimeout).mock.calls[0]

    expect(path).toBe('/api/create-consumer-reservation')
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      vehicleId: 'vehicle-id',
      fuelType: 'AI_95',
      requestedLiters: 20,
      clientMutationId: 'mutation-id',
    })
  })
})
