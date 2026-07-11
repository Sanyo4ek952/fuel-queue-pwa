import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  supabase: {
    rpc: vi.fn(),
  },
  cacheResidentFuelNormLiters: vi.fn(),
  getCachedResidentFuelNormLiters: vi.fn(async () => 20),
}))

vi.mock('@/shared/api/supabase', () => ({
  supabase: mocks.supabase,
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  cacheResidentFuelNormLiters: mocks.cacheResidentFuelNormLiters,
  getCachedResidentFuelNormLiters: mocks.getCachedResidentFuelNormLiters,
}))

import { supabase } from '@/shared/api/supabase'

import {
  getResidentFuelNorm,
  parseResidentFuelNormResult,
  setResidentFuelNorm,
} from './resident-fuel-norm'

describe('resident fuel norm RPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCachedResidentFuelNormLiters.mockResolvedValue(20)
  })

  it('parses a resident fuel norm setting response', () => {
    expect(
      parseResidentFuelNormResult({
        liters: '25.5',
        updated_at: '2026-07-11T10:00:00Z',
        client_mutation_id: 'mutation-id',
      }),
    ).toEqual({
      liters: 25.5,
      updated_at: '2026-07-11T10:00:00Z',
      client_mutation_id: 'mutation-id',
    })
  })

  it('loads and caches the current resident norm', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: '30',
      error: null,
    } as never)

    await expect(getResidentFuelNorm()).resolves.toEqual({
      data: { liters: 30, updated_at: null, client_mutation_id: null },
      error: null,
    })

    expect(supabase.rpc).toHaveBeenCalledWith('get_resident_fuel_norm_liters')
    expect(mocks.cacheResidentFuelNormLiters).toHaveBeenCalledWith(30)
  })

  it('saves and caches a mayor-updated norm', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        liters: 35,
        updated_at: '2026-07-11T10:00:00Z',
        client_mutation_id: 'mutation-id',
      },
      error: null,
    } as never)

    await expect(
      setResidentFuelNorm({ liters: 35, clientMutationId: 'mutation-id' }),
    ).resolves.toMatchObject({
      data: { liters: 35, client_mutation_id: 'mutation-id' },
      error: null,
    })

    expect(supabase.rpc).toHaveBeenCalledWith('set_resident_fuel_norm_liters', {
      liters: 35,
      client_mutation_id: 'mutation-id',
    })
    expect(mocks.cacheResidentFuelNormLiters).toHaveBeenCalledWith(35)
  })
})
