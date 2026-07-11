import { isSupabaseConfigured } from '@/shared/config/env'
import type { FuelQueueCategory } from '@/shared/constants'
import { supabase } from '@/shared/api/supabase'
import { cacheDailyFuelingSchedule } from '@/shared/lib/offline-db'

import type { RpcResult } from './index'

export type DailyFuelingScheduleRow = {
  id?: string | null
  date: string
  station_id: string
  fuel_category: FuelQueueCategory
  start_time: string
  interval_minutes: number
  vehicles_per_interval: number
  updated_at?: string | null
  client_mutation_id?: string | null
}

export type SetDailyFuelingScheduleParams = {
  targetDate: string
  stationId: string
  schedules: Array<{
    fuelCategory: FuelQueueCategory
    startTime: string
    intervalMinutes: number
    vehiclesPerInterval: number
  }>
  clientMutationId: string
}

function toInteger(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : null
}

function isFuelCategory(value: unknown): value is FuelQueueCategory {
  return value === 'GASOLINE' || value === 'DIESEL' || value === 'GAS'
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)
}

function parseScheduleRow(value: unknown): DailyFuelingScheduleRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const result = value as Partial<DailyFuelingScheduleRow>
  const intervalMinutes = toInteger(result.interval_minutes)
  const vehiclesPerInterval = toInteger(result.vehicles_per_interval)

  if (
    typeof result.date !== 'string' ||
    typeof result.station_id !== 'string' ||
    !isFuelCategory(result.fuel_category) ||
    !isTime(result.start_time) ||
    intervalMinutes === null ||
    vehiclesPerInterval === null
  ) {
    return null
  }

  return {
    id: result.id ?? null,
    date: result.date,
    station_id: result.station_id,
    fuel_category: result.fuel_category,
    start_time: result.start_time,
    interval_minutes: intervalMinutes,
    vehicles_per_interval: vehiclesPerInterval,
    updated_at: result.updated_at ?? null,
    client_mutation_id: result.client_mutation_id ?? null,
  }
}

export function parseDailyFuelingSchedule(value: unknown): DailyFuelingScheduleRow[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const rows = value.map(parseScheduleRow)

  return rows.every((row) => row !== null) ? (rows as DailyFuelingScheduleRow[]) : null
}

export async function getDailyFuelingSchedule(
  targetDate: string,
  stationId?: string | null,
): Promise<RpcResult<DailyFuelingScheduleRow[]>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('get_daily_fueling_schedule', {
    target_date: targetDate,
    target_station_id: stationId ?? null,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseDailyFuelingSchedule(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected get_daily_fueling_schedule response.',
    }
  }

  await cacheDailyFuelingSchedule(targetDate, parsed, stationId)

  return {
    data: parsed,
    error: null,
  }
}

export async function setDailyFuelingSchedule({
  targetDate,
  stationId,
  schedules,
  clientMutationId,
}: SetDailyFuelingScheduleParams): Promise<RpcResult<DailyFuelingScheduleRow[]>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('set_daily_fueling_schedule', {
    target_date: targetDate,
    target_station_id: stationId,
    schedules: schedules.map((schedule) => ({
      fuel_category: schedule.fuelCategory,
      start_time: schedule.startTime,
      interval_minutes: schedule.intervalMinutes,
      vehicles_per_interval: schedule.vehiclesPerInterval,
    })),
    client_mutation_id: clientMutationId,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseDailyFuelingSchedule(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected set_daily_fueling_schedule response.',
    }
  }

  await cacheDailyFuelingSchedule(targetDate, parsed, stationId)

  return {
    data: parsed,
    error: null,
  }
}
