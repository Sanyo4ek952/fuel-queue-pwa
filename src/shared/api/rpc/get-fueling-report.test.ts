import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import { parseFuelingReport } from './get-fueling-report'

describe('parseFuelingReport', () => {
  it('parses a valid get_fueling_report response with numeric strings', () => {
    expect(
      parseFuelingReport({
        summary: {
          total_liters: '125.75',
          fueling_count: '3',
          unique_vehicle_count: '2',
          average_liters_per_fueling: '41.916666',
        },
        by_station: [
          {
            station_id: 'station-id',
            station_name: 'АЗС №1',
            total_liters: '80.5',
            fueling_count: '2',
            unique_vehicle_count: '2',
          },
        ],
        by_fuel_type: [
          {
            fuel_type: 'AI_95',
            total_liters: '80.5',
            fueling_count: '2',
            unique_vehicle_count: '2',
          },
        ],
        by_day: [
          {
            date: '2026-07-07',
            total_liters: '125.75',
            fueling_count: '3',
            unique_vehicle_count: '2',
          },
        ],
      }),
    ).toMatchObject({
      summary: {
        total_liters: 125.75,
        fueling_count: 3,
        unique_vehicle_count: 2,
      },
      by_station: [{ total_liters: 80.5 }],
      by_fuel_type: [{ fuel_type: 'AI_95' }],
      by_day: [{ date: '2026-07-07' }],
    })
  })

  it('parses an empty report response', () => {
    expect(
      parseFuelingReport({
        summary: {
          total_liters: 0,
          fueling_count: 0,
          unique_vehicle_count: 0,
          average_liters_per_fueling: 0,
        },
        by_station: [],
        by_fuel_type: [],
        by_day: [],
      }),
    ).toEqual({
      summary: {
        total_liters: 0,
        fueling_count: 0,
        unique_vehicle_count: 0,
        average_liters_per_fueling: 0,
      },
      by_station: [],
      by_fuel_type: [],
      by_day: [],
    })
  })

  it('returns null for an unexpected response', () => {
    expect(parseFuelingReport({ summary: { total_liters: 'bad' } })).toBeNull()
  })
})
