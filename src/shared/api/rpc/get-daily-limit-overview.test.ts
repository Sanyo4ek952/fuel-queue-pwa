import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import { parseDailyLimitOverview } from './get-daily-limit-overview'

describe('parseDailyLimitOverview', () => {
  it('parses an existing daily limit overview', () => {
    expect(
      parseDailyLimitOverview({
        exists: true,
        id: 'limit-id',
        date: '2026-07-05',
        station_id: 'station-id',
        status: 'OPEN',
        total_vehicle_limit: '100',
        max_liters_per_vehicle: '50.5',
        occupied_vehicle_count: 12,
        remaining_vehicle_count: 88,
        updated_at: '2026-07-05T10:00:00.000Z',
        fuel_type_overviews: [
          {
            fuel_type: 'AI_95',
            vehicle_limit: '30',
            occupied_vehicle_count: '10',
            remaining_vehicle_count: '20',
            liters_limit: '1500.5',
            reserved_liters: '420.25',
            remaining_liters: '1080.25',
          },
        ],
      }),
    ).toMatchObject({
      exists: true,
      id: 'limit-id',
      total_vehicle_limit: 100,
      max_liters_per_vehicle: 50.5,
      fuel_type_overviews: [
        {
          fuel_type: 'AI_95',
          vehicle_limit: 30,
          reserved_liters: 420.25,
        },
      ],
    })
  })

  it('parses a missing daily limit response', () => {
    expect(
      parseDailyLimitOverview({
        exists: false,
        date: '2026-07-05',
        station_id: 'station-id',
        status: null,
        total_vehicle_limit: null,
        max_liters_per_vehicle: null,
        occupied_vehicle_count: 0,
        remaining_vehicle_count: null,
        fuel_type_overviews: [],
        updated_at: null,
      }),
    ).toMatchObject({
      exists: false,
      id: null,
      status: null,
      fuel_type_overviews: [],
    })
  })

  it('returns null for an unexpected response', () => {
    expect(parseDailyLimitOverview({ id: 'limit-id' })).toBeNull()
  })
})
