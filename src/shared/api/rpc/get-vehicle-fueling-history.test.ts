import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import { parseVehicleFuelingHistory } from './get-vehicle-fueling-history'

describe('parseVehicleFuelingHistory', () => {
  it('parses a vehicle fueling history response', () => {
    expect(
      parseVehicleFuelingHistory({
        normalized_plate_number: 'А123ВС777',
        vehicle_id: 'vehicle-id',
        vehicle_found: true,
        total_fueling_count: '3',
        regular_fueling_count: 2,
        manual_override_fueling_count: '1',
        total_liters: '120.5',
        first_fueled_at: '2026-07-01T10:00:00.000Z',
        last_fueled_at: '2026-07-05T10:00:00.000Z',
        station_summaries: [
          {
            station_id: 'station-id',
            station_name: 'АЗС №1',
            fueling_count: '3',
            total_liters: '120.5',
          },
        ],
        fuel_type_summaries: [
          {
            fuel_type: 'AI_95',
            fueling_count: '3',
            total_liters: '120.5',
          },
        ],
        records: [
          {
            id: 'fueling-id',
            date: '2026-07-05',
            fueled_at: '2026-07-05T10:00:00.000Z',
            liters: '40.5',
            station_id: 'station-id',
            station_name: 'Station 1',
            fuel_type: 'AI_95',
            is_manual_override: false,
            sync_status: 'SYNCED',
          },
        ],
        has_more: true,
      }),
    ).toMatchObject({
      normalized_plate_number: 'А123ВС777',
      total_fueling_count: 3,
      total_liters: 120.5,
      station_summaries: [{ station_name: 'АЗС №1', fueling_count: 3 }],
    })
  })

  it('parses a missing vehicle response', () => {
    expect(
      parseVehicleFuelingHistory({
        normalized_plate_number: 'А123ВС777',
        vehicle_id: null,
        vehicle_found: false,
        total_fueling_count: 0,
        regular_fueling_count: 0,
        manual_override_fueling_count: 0,
        total_liters: 0,
        first_fueled_at: null,
        last_fueled_at: null,
        station_summaries: [],
        fuel_type_summaries: [],
      }),
    ).toMatchObject({
      vehicle_found: false,
      vehicle_id: null,
      total_fueling_count: 0,
    })
  })

  it('parses paginated fueling records', () => {
    expect(
      parseVehicleFuelingHistory({
        normalized_plate_number: 'А123ВС777',
        vehicle_id: 'vehicle-id',
        vehicle_found: true,
        total_fueling_count: 11,
        regular_fueling_count: 10,
        manual_override_fueling_count: 1,
        total_liters: '440.5',
        first_fueled_at: '2026-07-01T10:00:00.000Z',
        last_fueled_at: '2026-07-05T10:00:00.000Z',
        station_summaries: [],
        fuel_type_summaries: [],
        records: [
          {
            id: 'fueling-id',
            date: '2026-07-05',
            fueled_at: '2026-07-05T10:00:00.000Z',
            liters: '40.5',
            station_id: 'station-id',
            station_name: 'Station 1',
            fuel_type: 'AI_95',
            is_manual_override: true,
            sync_status: 'PENDING',
          },
        ],
        has_more: true,
      }),
    ).toMatchObject({
      records: [
        {
          id: 'fueling-id',
          liters: 40.5,
          is_manual_override: true,
          sync_status: 'PENDING',
        },
      ],
      has_more: true,
    })
  })

  it('returns null for an unexpected response', () => {
    expect(parseVehicleFuelingHistory({ total_fueling_count: 1 })).toBeNull()
  })
})
