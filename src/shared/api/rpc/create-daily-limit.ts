import { isSupabaseConfigured } from '@/shared/config/env'
import type { DailyLimitMode, QueueFuelType } from '@/shared/constants'

import type { RpcResult } from './index'
import { requestProtectedRpcApi } from './protected-api'

export type DailyFuelTypeLimitInput = {
  fuelType: QueueFuelType
  status: 'OPEN' | 'PAUSED'
  vehicleLimit: number
  litersLimit?: number | null
}

export type CreateDailyLimitParams = {
  targetDate: string
  stationId: string
  fuelTypeLimits: DailyFuelTypeLimitInput[]
  clientMutationId: string
}

export type DailyFuelTypeLimitResult = {
  fuel_type: QueueFuelType
  fuel_category: string
  limit_mode?: DailyLimitMode
  status: 'OPEN' | 'PAUSED'
  vehicle_limit: number
  liters_limit: number | null
}

export type CreateDailyLimitResult = {
  id: string
  date: string
  station_id: string | null
  status: 'OPEN' | 'CLOSED' | 'PAUSED'
  client_mutation_id: string
  fuel_type_limits: DailyFuelTypeLimitResult[]
  category_limits: DailyFuelTypeLimitResult[]
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function getCreateDailyLimitErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase()
  const isAllocatorOverloadError =
    message.includes('function public.allocate_daily_queue(date) is not unique') ||
    message.includes('Could not choose the best candidate function') ||
    normalizedMessage.includes('allocate_daily_queue') &&
      (normalizedMessage.includes('not unique') ||
        normalizedMessage.includes('best candidate function') ||
        normalizedMessage.includes('ambiguous'))

  return isAllocatorOverloadError
    ? 'Не удалось пересчитать очередь после изменения лимита. Обновите страницу и повторите сохранение лимита.'
    : message
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
      fuel_type_limits: Array.isArray(result.fuel_type_limits)
        ? result.fuel_type_limits.map((item) => ({
            fuel_type: item.fuel_type,
            fuel_category: item.fuel_category,
            limit_mode: item.limit_mode,
            status: item.status ?? 'OPEN',
            vehicle_limit: toNumber(item.vehicle_limit),
            liters_limit: item.liters_limit == null ? null : toNumber(item.liters_limit),
          }))
        : [],
      category_limits: Array.isArray(result.category_limits)
        ? result.category_limits.map((item) => ({
            fuel_type: item.fuel_type,
            fuel_category: item.fuel_category,
            limit_mode: item.limit_mode,
            status: item.status ?? 'OPEN',
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
  fuelTypeLimits,
  clientMutationId,
}: CreateDailyLimitParams): Promise<RpcResult<CreateDailyLimitResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/create-daily-limit',
      {
        targetDate,
        stationId,
        fuelTypeLimits: fuelTypeLimits.map((item) => ({
          fuel_type: item.fuelType,
          status: item.status,
          vehicle_limit: 0,
          liters_limit: item.litersLimit ?? null,
        })),
        clientMutationId,
      },
      'Create daily limit request failed.',
    )
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Create daily limit request failed.'

    return {
      data: null,
      error: getCreateDailyLimitErrorMessage(message),
    }
  }
}
