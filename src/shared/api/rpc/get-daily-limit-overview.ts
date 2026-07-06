import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import type { DailyLimitMode, FuelQueueCategory } from '@/shared/constants'

import type { RpcResult } from './index'

export type DailyLimitStatus = 'OPEN' | 'CLOSED' | 'PAUSED'

export type DailyLimitCategoryOverview = {
  fuel_category: FuelQueueCategory
  label: string
  limit_mode: DailyLimitMode
  vehicle_limit: number
  liters_limit: number | null
  queue_count: number
  queued_liters: number
  covered_vehicle_count: number
  covered_liters: number
  remaining_vehicle_count: number | null
  remaining_liters: number | null
  projected_queue_number: number | null
}

export type DailyLimitOverview = {
  exists: boolean
  id: string | null
  date: string
  station_id: string | null
  status: DailyLimitStatus | null
  category_overviews: DailyLimitCategoryOverview[]
  updated_at: string | null
}

export type GetDailyLimitOverviewParams = {
  date: string
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function toNullableNumber(value: unknown) {
  return value == null ? null : toNumber(value)
}

function parseCategoryOverview(value: unknown): DailyLimitCategoryOverview | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<DailyLimitCategoryOverview>

  if (typeof result.fuel_category !== 'string') {
    return null
  }

  return {
    fuel_category: result.fuel_category as FuelQueueCategory,
    label: result.label ?? result.fuel_category,
    limit_mode: (result.limit_mode ?? 'vehicle_count') as DailyLimitMode,
    vehicle_limit: toNumber(result.vehicle_limit),
    liters_limit: toNullableNumber(result.liters_limit),
    queue_count: toNumber(result.queue_count),
    queued_liters: toNumber(result.queued_liters),
    covered_vehicle_count: toNumber(result.covered_vehicle_count),
    covered_liters: toNumber(result.covered_liters),
    remaining_vehicle_count: toNullableNumber(result.remaining_vehicle_count),
    remaining_liters: toNullableNumber(result.remaining_liters),
    projected_queue_number: toNullableNumber(result.projected_queue_number),
  }
}

export function parseDailyLimitOverview(value: unknown): DailyLimitOverview | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<DailyLimitOverview>

  if (typeof result.exists !== 'boolean' || typeof result.date !== 'string') {
    return null
  }

  const categoryOverviews = Array.isArray(result.category_overviews)
    ? result.category_overviews.map(parseCategoryOverview)
    : []

  if (categoryOverviews.some((item) => item === null)) {
    return null
  }

  return {
    exists: result.exists,
    id: result.id ?? null,
    date: result.date,
    station_id: result.station_id ?? null,
    status: result.status ?? null,
    category_overviews: categoryOverviews as DailyLimitCategoryOverview[],
    updated_at: result.updated_at ?? null,
  }
}

export async function getDailyLimitOverview({
  date,
}: GetDailyLimitOverviewParams): Promise<RpcResult<DailyLimitOverview>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('get_daily_limit_overview', {
    target_date: date,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseDailyLimitOverview(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected get_daily_limit_overview response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
