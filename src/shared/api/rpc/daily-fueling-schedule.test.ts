import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestProtectedRpcApi: vi.fn(),
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  cacheDailyFuelingSchedule: vi.fn(),
}))

vi.mock('./protected-api', () => ({
  requestProtectedRpcApi: mocks.requestProtectedRpcApi,
}))

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
    mocks.requestProtectedRpcApi.mockResolvedValueOnce([])

    const result = await getDailyFuelingSchedule('2026-07-09', 'station-id')

    expect(mocks.requestProtectedRpcApi).toHaveBeenCalledWith(
      '/api/get-daily-fueling-schedule',
      {
        targetDate: '2026-07-09',
        stationId: 'station-id',
      },
      'Daily fueling schedule request failed.',
    )
    expect(result).toEqual({ data: [], error: null })
  })

  it('saves the schedule through the mutation RPC', async () => {
    mocks.requestProtectedRpcApi.mockResolvedValueOnce([])

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

    expect(mocks.requestProtectedRpcApi).toHaveBeenCalledWith(
      '/api/set-daily-fueling-schedule',
      {
        targetDate: '2026-07-09',
        stationId: 'station-id',
        schedules: [
        {
          fuel_category: 'GASOLINE',
          start_time: '13:00',
          interval_minutes: 5,
          vehicles_per_interval: 5,
        },
        ],
        clientMutationId: 'mutation-id',
      },
      'Set daily fueling schedule request failed.',
    )
    expect(result).toEqual({ data: [], error: null })
  })
})
