import { isSupabaseConfigured } from '@/shared/config/env'
import { getAuthSession } from '@/shared/api/auth'
import { supabase } from '@/shared/api/supabase'
import type { DailyLimitMode, FuelQueueCategory, QueueFuelType } from '@/shared/constants'
import { fetchWithTimeout } from '@/shared/lib/fetch-with-timeout'

import type { RpcResult } from './index'

export type DailyLimitStatus = 'OPEN' | 'CLOSED' | 'PAUSED'

export type DailyLimitCategoryOverview = {
  fuel_type?: QueueFuelType
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

export type DailyLimitStationOverview = {
  exists: boolean
  id: string | null
  date: string
  station_id: string | null
  station_name: string | null
  station_address: string | null
  status: DailyLimitStatus | null
  category_overviews: DailyLimitCategoryOverview[]
  updated_at: string | null
}

export type DailyLimitOverview = DailyLimitStationOverview & {
  station_overviews: DailyLimitStationOverview[]
}

export type GetDailyLimitOverviewParams = {
  date: string
}

class DailyLimitOverviewApiError extends Error {
  statusCode: number | null

  constructor(message: string, statusCode: number | null = null) {
    super(message)
    this.statusCode = statusCode
  }
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
    fuel_type: result.fuel_type as QueueFuelType | undefined,
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

function parseStationOverview(
  value: unknown,
  fallbackDate: string,
): DailyLimitStationOverview | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<DailyLimitStationOverview>
  const categoryOverviews = Array.isArray(result.category_overviews)
    ? result.category_overviews.map(parseCategoryOverview)
    : []

  if (categoryOverviews.some((item) => item === null)) {
    return null
  }

  return {
    exists: true,
    id: result.id ?? null,
    date: result.date ?? fallbackDate,
    station_id: result.station_id ?? null,
    station_name: result.station_name ?? null,
    station_address: result.station_address ?? null,
    status: result.status ?? null,
    category_overviews: categoryOverviews as DailyLimitCategoryOverview[],
    updated_at: result.updated_at ?? null,
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

  const date = result.date
  const categoryOverviews = Array.isArray(result.category_overviews)
    ? result.category_overviews.map(parseCategoryOverview)
    : []

  if (categoryOverviews.some((item) => item === null)) {
    return null
  }

  const stationOverviews = Array.isArray(result.station_overviews)
    ? result.station_overviews.map((item) => parseStationOverview(item, date))
    : []

  if (stationOverviews.some((item) => item === null)) {
    return null
  }

  return {
    exists: result.exists,
    id: result.id ?? null,
    date,
    station_id: result.station_id ?? null,
    station_name: result.station_name ?? null,
    station_address: result.station_address ?? null,
    status: result.status ?? null,
    category_overviews: categoryOverviews as DailyLimitCategoryOverview[],
    station_overviews: stationOverviews as DailyLimitStationOverview[],
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

async function readDailyLimitOverviewApiResponse(response: Response) {
  const value = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
        ? value.error
        : 'Daily limit overview request failed.'

    throw new DailyLimitOverviewApiError(message, response.status)
  }

  return value
}

export async function getDailyLimitOverviewViaApi({
  date,
}: GetDailyLimitOverviewParams): Promise<RpcResult<DailyLimitOverview>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const sessionResult = await getAuthSession()

  if (sessionResult.error || !sessionResult.data?.access_token) {
    return {
      data: null,
      error: sessionResult.error ?? 'Authorization token is required.',
    }
  }

  try {
    const response = await fetchWithTimeout(
      '/api/daily-limit-overview',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionResult.data.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ date }),
      },
      {
        timeoutMs: 10_000,
        timeoutMessage: 'Daily limit overview request timed out.',
      },
    )
    const value = await readDailyLimitOverviewApiResponse(response)
    const parsed = parseDailyLimitOverview(value)

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
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Daily limit overview request failed.',
    }
  }
}
