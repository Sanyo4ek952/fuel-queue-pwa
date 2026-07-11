import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  cacheDailyFuelingSchedule: vi.fn(),
}))

import { supabase } from '@/shared/api/supabase'

import {
  getDailyFuelingSchedule,
  parseDailyFuelingSchedule,
  setDailyFuelingSchedule,
} from './daily-fueling-schedule'

describe('parseDailyFuelingSchedule', () => {
  it('parses a valid schedule response', () => {
    expect(
      parseDailyFuelingSchedule([
        {
          id: 'schedule-id',
          date: '2026-07-09',
          station_id: 'station-id',
          fuel_category: 'GASOLINE',
          start_time: '13:00',
          interval_minutes: '5',
          vehicles_per_interval: 5,
          updated_at: '2026-07-09T10:00:00.000Z',
          client_mutation_id: 'mutation-id',
        },
      ]),
    ).toEqual([
      {
        id: 'schedule-id',
        date: '2026-07-09',
        station_id: 'station-id',
        fuel_category: 'GASOLINE',
        start_time: '13:00',
        interval_minutes: 5,
        vehicles_per_interval: 5,
        updated_at: '2026-07-09T10:00:00.000Z',
        client_mutation_id: 'mutation-id',
      },
    ])
  })

  it('returns null for an unexpected response', () => {
    expect(parseDailyFuelingSchedule({ fuel_category: 'GASOLINE' })).toBeNull()
    expect(parseDailyFuelingSchedule([{ fuel_category: 'OTHER' }])).toBeNull()
  })
})

describe('daily fueling schedule RPC wrappers', () => {
  it('loads the schedule by date', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [],
      error: null,
    } as never)

    const result = await getDailyFuelingSchedule('2026-07-09', 'station-id')

    expect(supabase.rpc).toHaveBeenCalledWith('get_daily_fueling_schedule', {
      target_date: '2026-07-09',
      target_station_id: 'station-id',
    })
    expect(result).toEqual({ data: [], error: null })
  })

  it('saves the schedule through the mutation RPC', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [],
      error: null,
    } as never)

    const result = await setDailyFuelingSchedule({
      targetDate: '2026-07-09',
      stationId: 'station-id',
      schedules: [
        {
          fuelCategory: 'GASOLINE',
          startTime: '13:00',
          intervalMinutes: 5,
          vehiclesPerInterval: 5,
        },
      ],
      clientMutationId: 'mutation-id',
    })

    expect(supabase.rpc).toHaveBeenCalledWith('set_daily_fueling_schedule', {
      target_date: '2026-07-09',
      target_station_id: 'station-id',
      schedules: [
        {
          fuel_category: 'GASOLINE',
          start_time: '13:00',
          interval_minutes: 5,
          vehicles_per_interval: 5,
        },
      ],
      client_mutation_id: 'mutation-id',
    })
    expect(result).toEqual({ data: [], error: null })
  })
})
