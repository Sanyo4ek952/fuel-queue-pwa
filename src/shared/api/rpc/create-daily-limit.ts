import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import type { DailyLimitMode, FuelQueueCategory } from '@/shared/constants'

import type { RpcResult } from './index'

export type DailyCategoryLimitInput = {
  fuelCategory: FuelQueueCategory
  limitMode: DailyLimitMode
  vehicleLimit: number
  litersLimit?: number | null
}

export type CreateDailyLimitParams = {
  targetDate: string
  categoryLimits: DailyCategoryLimitInput[]
  clientMutationId: string
}

export type DailyCategoryLimitResult = {
  fuel_category: FuelQueueCategory
  limit_mode: DailyLimitMode
  vehicle_limit: number
  liters_limit: number | null
}

export type CreateDailyLimitResult = {
  id: string
  date: string
  station_id: string | null
  status: 'OPEN' | 'CLOSED' | 'PAUSED'
  client_mutation_id: string
  category_limits: DailyCategoryLimitResult[]
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function toDailyLimitResult(value: unknown): CreateDailyLimitResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<CreateDailyLimitResult>

  if (
    typeof result.id === 'string' &&
    typeof result.date === 'string' &&
    typeof result.status === 'string' &&
    typeof result.client_mutation_id === 'string'
  ) {
    return {
      id: result.id,
      date: result.date,
      station_id: result.station_id ?? null,
      status: result.status as CreateDailyLimitResult['status'],
      client_mutation_id: result.client_mutation_id,
      category_limits: Array.isArray(result.category_limits)
        ? result.category_limits.map((item) => ({
            fuel_category: item.fuel_category,
            limit_mode: item.limit_mode,
            vehicle_limit: toNumber(item.vehicle_limit),
            liters_limit: item.liters_limit == null ? null : toNumber(item.liters_limit),
          }))
        : [],
    }
  }

  return null
}

export async function createDailyLimit({
  targetDate,
  categoryLimits,
  clientMutationId,
}: CreateDailyLimitParams): Promise<RpcResult<CreateDailyLimitResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const byCategory = new Map(categoryLimits.map((item) => [item.fuelCategory, item]))
  const gasoline = byCategory.get('GASOLINE')
  const diesel = byCategory.get('DIESEL')
  const gas = byCategory.get('GAS')

  const { data, error } = await supabase.rpc('create_daily_limit', {
    target_date: targetDate,
    gasoline_limit_mode: gasoline?.limitMode ?? 'vehicle_count',
    gasoline_vehicle_limit: gasoline?.vehicleLimit ?? 0,
    gasoline_liters_limit: gasoline?.litersLimit ?? null,
    diesel_limit_mode: diesel?.limitMode ?? 'vehicle_count',
    diesel_vehicle_limit: diesel?.vehicleLimit ?? 0,
    diesel_liters_limit: diesel?.litersLimit ?? null,
    gas_limit_mode: gas?.limitMode ?? 'vehicle_count',
    gas_vehicle_limit: gas?.vehicleLimit ?? 0,
    gas_liters_limit: gas?.litersLimit ?? null,
    client_mutation_id: clientMutationId,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = toDailyLimitResult(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected create_daily_limit response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
