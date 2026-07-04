import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import type { FuelType } from '@/shared/constants'

import type { RpcResult } from './index'

export type DailyFuelTypeLimitInput = {
  fuelType: FuelType
  vehicleLimit: number
  litersLimit?: number | null
}

export type CreateDailyLimitParams = {
  targetDate: string
  stationId: string
  totalVehicleLimit: number
  maxLitersPerVehicle: number
  fuelTypeLimits: DailyFuelTypeLimitInput[]
  clientMutationId: string
}

export type DailyFuelTypeLimitResult = {
  id: string
  fuel_type: FuelType
  vehicle_limit: number
  liters_limit: number | null
}

export type CreateDailyLimitResult = {
  id: string
  date: string
  station_id: string
  total_vehicle_limit: number
  max_liters_per_vehicle: number
  status: 'OPEN' | 'CLOSED' | 'PAUSED'
  client_mutation_id: string
  fuel_type_limits: DailyFuelTypeLimitResult[]
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
    typeof result.station_id === 'string' &&
    typeof result.status === 'string' &&
    typeof result.client_mutation_id === 'string'
  ) {
    return {
      id: result.id,
      date: result.date,
      station_id: result.station_id,
      total_vehicle_limit: toNumber(result.total_vehicle_limit),
      max_liters_per_vehicle: toNumber(result.max_liters_per_vehicle),
      status: result.status as CreateDailyLimitResult['status'],
      client_mutation_id: result.client_mutation_id,
      fuel_type_limits: Array.isArray(result.fuel_type_limits)
        ? result.fuel_type_limits.map((item) => ({
            id: item.id,
            fuel_type: item.fuel_type,
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
  stationId,
  totalVehicleLimit,
  maxLitersPerVehicle,
  fuelTypeLimits,
  clientMutationId,
}: CreateDailyLimitParams): Promise<RpcResult<CreateDailyLimitResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('create_daily_limit', {
    target_date: targetDate,
    target_station_id: stationId,
    total_vehicle_limit: totalVehicleLimit,
    max_liters_per_vehicle: maxLitersPerVehicle,
    fuel_type_limits: fuelTypeLimits.map((item) => ({
      fuel_type: item.fuelType,
      vehicle_limit: item.vehicleLimit,
      liters_limit: item.litersLimit ?? null,
    })),
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
