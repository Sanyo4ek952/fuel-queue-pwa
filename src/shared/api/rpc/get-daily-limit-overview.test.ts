import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
}))

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))
vi.mock('@/shared/api/auth', () => ({ getAuthSession: mocks.getAuthSession }))
vi.mock('@/shared/config/env', () => ({ isSupabaseConfigured: true }))

import { getDailyLimitOverviewViaApi, parseDailyLimitOverview } from './get-daily-limit-overview'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseDailyLimitOverview', () => {
  it('parses an existing daily limit overview', () => {
    expect(
      parseDailyLimitOverview({
        exists: true,
        id: 'limit-id',
        date: '2026-07-05',
        station_id: null,
        station_name: 'Общий пул',
        station_address: null,
        status: 'OPEN',
        updated_at: '2026-07-05T10:00:00.000Z',
        station_overviews: [
          {
            id: 'station-limit-id',
            date: '2026-07-05',
            station_id: 'station-id',
            station_name: 'АЗС №1',
            station_address: 'Адрес 1',
            status: 'OPEN',
            updated_at: '2026-07-05T10:00:00.000Z',
            category_overviews: [
              {
                fuel_type: 'AI_95',
                fuel_category: 'GASOLINE',
                label: 'АИ-95',
                limit_mode: 'fuel_liters',
                vehicle_limit: '0',
                liters_limit: '500',
                queue_count: '2',
                queued_liters: '80',
                covered_vehicle_count: '2',
                covered_liters: '40',
                remaining_vehicle_count: null,
                remaining_liters: '460',
                projected_queue_number: '2',
              },
            ],
          },
        ],
        category_overviews: [
          {
            fuel_category: 'GASOLINE',
            label: 'Бензин',
            limit_mode: 'fuel_liters',
            vehicle_limit: '0',
            liters_limit: '1500.5',
            queue_count: '12',
            queued_liters: '420.25',
            covered_vehicle_count: '10',
            covered_liters: '400.25',
            remaining_vehicle_count: null,
            remaining_liters: '1100.25',
            projected_queue_number: '12',
          },
        ],
      }),
    ).toMatchObject({
      exists: true,
      id: 'limit-id',
      station_name: 'Общий пул',
      category_overviews: [
        {
          fuel_category: 'GASOLINE',
          limit_mode: 'fuel_liters',
          liters_limit: 1500.5,
          queue_count: 12,
          covered_vehicle_count: 10,
          covered_liters: 400.25,
          remaining_liters: 1100.25,
          queued_liters: 420.25,
          projected_queue_number: 12,
        },
      ],
      station_overviews: [
        {
          station_id: 'station-id',
          station_name: 'АЗС №1',
          station_address: 'Адрес 1',
          category_overviews: [
            {
              fuel_type: 'AI_95',
              remaining_liters: 460,
            },
          ],
        },
      ],
    })
  })

  it('parses a missing daily limit response', () => {
    expect(
      parseDailyLimitOverview({
        exists: false,
        date: '2026-07-05',
        status: null,
        category_overviews: [],
        updated_at: null,
      }),
    ).toMatchObject({
      exists: false,
      id: null,
      status: null,
      category_overviews: [],
    })
  })

  it('parses a legacy global daily limit as its own station section', () => {
    expect(
      parseDailyLimitOverview({
        exists: true,
        id: 'global-limit-id',
        date: '2026-07-05',
        station_id: null,
        station_name: 'Все АЗС',
        station_address: null,
        status: 'OPEN',
        updated_at: '2026-07-05T10:00:00.000Z',
        station_overviews: [
          {
            id: 'global-limit-id',
            date: '2026-07-05',
            station_id: null,
            station_name: 'Все АЗС',
            station_address: null,
            status: 'OPEN',
            updated_at: '2026-07-05T10:00:00.000Z',
            category_overviews: [],
          },
        ],
        category_overviews: [],
      }),
    ).toMatchObject({
      station_overviews: [
        {
          station_id: null,
          station_name: 'Все АЗС',
          station_address: null,
        },
      ],
    })
  })

  it('returns null for an unexpected response', () => {
    expect(parseDailyLimitOverview({ id: 'limit-id' })).toBeNull()
  })
})

describe('getDailyLimitOverviewViaApi', () => {
  it('uses the protected local API proxy', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          exists: false,
          date: '2026-07-05',
          status: null,
          category_overviews: [],
          station_overviews: [],
          updated_at: null,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getDailyLimitOverviewViaApi({ date: '2026-07-05' })).resolves.toMatchObject({
      data: { exists: false, date: '2026-07-05' },
      error: null,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/daily-limit-overview',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ date: '2026-07-05' }),
      }),
    )
  })
})
