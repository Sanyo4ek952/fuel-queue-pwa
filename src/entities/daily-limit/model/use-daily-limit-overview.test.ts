import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/rpc', () => ({
  getDailyLimitOverview: vi.fn(),
}))

import type { DailyLimitOverview } from '@/shared/api/rpc'
import type { LocalReservation } from '@/shared/lib/offline-db'

import { applyUnsyncedReservationEstimate } from './use-daily-limit-overview'

const overview: DailyLimitOverview = {
  exists: true,
  id: 'limit-id',
  date: '2026-07-05',
  station_id: 'station-id',
  status: 'OPEN',
  total_vehicle_limit: 10,
  max_liters_per_vehicle: 50,
  occupied_vehicle_count: 2,
  remaining_vehicle_count: 8,
  updated_at: '2026-07-05T10:00:00.000Z',
  fuel_type_overviews: [
    {
      fuel_type: 'AI_95',
      vehicle_limit: 4,
      occupied_vehicle_count: 1,
      remaining_vehicle_count: 3,
      liters_limit: 200,
      reserved_liters: 40,
      remaining_liters: 160,
    },
  ],
}

function makeReservation(overrides: Partial<LocalReservation>): LocalReservation {
  return {
    id: 'reservation-id',
    station_id: 'station-id',
    vehicle_id: 'vehicle-id',
    date: '2026-07-05',
    status: 'RESERVED',
    queue_number: 1,
    fuel_type: 'AI_95',
    requested_liters: 30,
    sync_status: 'PENDING',
    ...overrides,
  }
}

describe('applyUnsyncedReservationEstimate', () => {
  it('subtracts unsynced active reservations from vehicle and liters remainders', () => {
    const result = applyUnsyncedReservationEstimate(
      overview,
      [
        makeReservation({ id: 'pending-1', requested_liters: 30 }),
        makeReservation({ id: 'synced-1', sync_status: 'SYNCED', requested_liters: 30 }),
        makeReservation({ id: 'cancelled-1', status: 'CANCELLED', requested_liters: 30 }),
      ],
      'offline',
    )

    expect(result).toMatchObject({
      occupied_vehicle_count: 3,
      remaining_vehicle_count: 7,
      is_estimated: true,
      unsynced_reservation_count: 1,
    })
    expect(result.fuel_type_overviews.find((item) => item.fuel_type === 'AI_95')).toMatchObject({
      occupied_vehicle_count: 2,
      remaining_vehicle_count: 2,
      reserved_liters: 70,
      remaining_liters: 130,
    })
  })

  it('keeps online data authoritative when there are no unsynced reservations', () => {
    const result = applyUnsyncedReservationEstimate(overview, [], 'online')

    expect(result).toMatchObject({
      occupied_vehicle_count: 2,
      remaining_vehicle_count: 8,
      is_estimated: false,
      unsynced_reservation_count: 0,
    })
  })
})
