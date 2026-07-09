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
  station_id: null,
  status: 'OPEN',
  updated_at: '2026-07-05T10:00:00.000Z',
  category_overviews: [
    {
      fuel_type: 'AI_95',
      fuel_category: 'GASOLINE',
      label: 'АИ-95',
      limit_mode: 'fuel_liters',
      vehicle_limit: 0,
      liters_limit: 200,
      queue_count: 2,
      queued_liters: 80,
      covered_vehicle_count: 2,
      covered_liters: 80,
      remaining_vehicle_count: null,
      remaining_liters: 120,
      projected_queue_number: 2,
    },
  ],
}

function makeReservation(overrides: Partial<LocalReservation>): LocalReservation {
  return {
    id: 'reservation-id',
    station_id: null,
    vehicle_id: 'vehicle-id',
    date: null,
    status: 'RESERVED',
    queue_number: 1,
    fuel_type: 'AI_95',
    requested_liters: 30,
    sync_status: 'PENDING',
    ...overrides,
  }
}

describe('applyUnsyncedReservationEstimate', () => {
  it('adds unsynced active reservations to the queue without subtracting actual remaining liters', () => {
    const result = applyUnsyncedReservationEstimate(
      overview,
      [
        makeReservation({ id: 'pending-1', queue_number: 3, requested_liters: 30 }),
        makeReservation({ id: 'synced-1', sync_status: 'SYNCED', requested_liters: 30 }),
        makeReservation({ id: 'cancelled-1', status: 'CANCELLED', requested_liters: 30 }),
      ],
      'offline',
    )

    expect(result).toMatchObject({
      is_estimated: true,
      unsynced_reservation_count: 1,
    })
    expect(
      result.category_overviews.find((item) => item.fuel_type === 'AI_95'),
    ).toMatchObject({
      queue_count: 3,
      queued_liters: 110,
      covered_vehicle_count: 3,
      covered_liters: 80,
      remaining_liters: 120,
      projected_queue_number: 3,
    })
  })

  it('keeps online data authoritative when there are no unsynced reservations', () => {
    const result = applyUnsyncedReservationEstimate(overview, [], 'online')

    expect(result).toMatchObject({
      is_estimated: false,
      unsynced_reservation_count: 0,
    })
    expect(result.category_overviews[0]).toMatchObject({
      covered_vehicle_count: 2,
      remaining_liters: 120,
    })
  })
})
