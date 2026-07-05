import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import type { FuelType } from '@/shared/constants'

import type { RpcResult } from './index'

export type DailyLimitStatus = 'OPEN' | 'CLOSED' | 'PAUSED'

export type DailyLimitFuelTypeOverview = {
  fuel_type: FuelType
  vehicle_limit: number
  occupied_vehicle_count: number
  remaining_vehicle_count: number
  liters_limit: number | null
  reserved_liters: number
  remaining_liters: number | null
}

export type DailyLimitOverview = {
  exists: boolean
  id: string | null
  date: string
  station_id: string
  status: DailyLimitStatus | null
  total_vehicle_limit: number | null
  max_liters_per_vehicle: number | null
  occupied_vehicle_count: number
  remaining_vehicle_count: number | null
  fuel_type_overviews: DailyLimitFuelTypeOverview[]
  updated_at: string | null
}

export type GetDailyLimitOverviewParams = {
  stationId: string
  date: string
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function toNullableNumber(value: unknown) {
  return value == null ? null : toNumber(value)
}

function parseFuelTypeOverview(value: unknown): DailyLimitFuelTypeOverview | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<DailyLimitFuelTypeOverview>

  if (typeof result.fuel_type !== 'string') {
    return null
  }

  return {
    fuel_type: result.fuel_type as FuelType,
    vehicle_limit: toNumber(result.vehicle_limit),
    occupied_vehicle_count: toNumber(result.occupied_vehicle_count),
    remaining_vehicle_count: toNumber(result.remaining_vehicle_count),
    liters_limit: toNullableNumber(result.liters_limit),
    reserved_liters: toNumber(result.reserved_liters),
    remaining_liters: toNullableNumber(result.remaining_liters),
  }
}

export function parseDailyLimitOverview(value: unknown): DailyLimitOverview | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<DailyLimitOverview>

  if (
    typeof result.exists !== 'boolean' ||
    typeof result.date !== 'string' ||
    typeof result.station_id !== 'string'
  ) {
    return null
  }

  const fuelTypeOverviews = Array.isArray(result.fuel_type_overviews)
    ? result.fuel_type_overviews.map(parseFuelTypeOverview)
    : []

  if (fuelTypeOverviews.some((item) => item === null)) {
    return null
  }

  return {
    exists: result.exists,
    id: result.id ?? null,
    date: result.date,
    station_id: result.station_id,
    status: result.status ?? null,
    total_vehicle_limit: toNullableNumber(result.total_vehicle_limit),
    max_liters_per_vehicle: toNullableNumber(result.max_liters_per_vehicle),
    occupied_vehicle_count: toNumber(result.occupied_vehicle_count),
    remaining_vehicle_count: toNullableNumber(result.remaining_vehicle_count),
    fuel_type_overviews: fuelTypeOverviews as DailyLimitFuelTypeOverview[],
    updated_at: result.updated_at ?? null,
  }
}

export async function getDailyLimitOverview({
  stationId,
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
    target_station_id: stationId,
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
