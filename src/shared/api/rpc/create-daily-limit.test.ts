import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}))

import { createDailyLimit } from './create-daily-limit'

describe('createDailyLimit', () => {
  it('sends liter limits without exposing vehicle count as a capacity control', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        id: 'limit-id',
        date: '2026-07-05',
        station_id: 'station-id',
        status: 'OPEN',
        client_mutation_id: 'mutation-id',
        fuel_type_limits: [
          {
            fuel_type: 'AI_95',
            fuel_category: 'GASOLINE',
            limit_mode: 'fuel_liters',
            status: 'OPEN',
            vehicle_limit: 0,
            liters_limit: 400,
          },
        ],
        category_limits: [],
      },
      error: null,
    })

    const result = await createDailyLimit({
      targetDate: '2026-07-05',
      stationId: 'station-id',
      clientMutationId: 'mutation-id',
      fuelTypeLimits: [
        {
          fuelType: 'AI_95',
          status: 'OPEN',
          vehicleLimit: 25,
          litersLimit: 400,
        },
      ],
    })

    expect(result.error).toBeNull()
    expect(mocks.rpc).toHaveBeenCalledWith('create_daily_limit', {
      target_date: '2026-07-05',
      target_station_id: 'station-id',
      client_mutation_id: 'mutation-id',
      fuel_type_limits: [
        {
          fuel_type: 'AI_95',
          status: 'OPEN',
          vehicle_limit: 0,
          liters_limit: 400,
        },
      ],
    })
    expect(result.data?.fuel_type_limits[0]).toMatchObject({
      fuel_type: 'AI_95',
      limit_mode: 'fuel_liters',
      vehicle_limit: 0,
      liters_limit: 400,
    })
  })
})
