import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import type { FuelType } from '@/shared/constants'

import type { RpcResult } from './index'

export type FuelingReportSummary = {
  total_liters: number
  fueling_count: number
  unique_vehicle_count: number
  average_liters_per_fueling: number
}

export type FuelingReportStationRow = {
  station_id: string
  station_name: string
  total_liters: number
  fueling_count: number
  unique_vehicle_count: number
}

export type FuelingReportFuelTypeRow = {
  fuel_type: FuelType | string
  total_liters: number
  fueling_count: number
  unique_vehicle_count: number
}

export type FuelingReportDayRow = {
  date: string
  total_liters: number
  fueling_count: number
  unique_vehicle_count: number
}

export type FuelingReport = {
  summary: FuelingReportSummary
  by_station: FuelingReportStationRow[]
  by_fuel_type: FuelingReportFuelTypeRow[]
  by_day: FuelingReportDayRow[]
}

export type GetFuelingReportParams = {
  dateFrom: string
  dateTo: string
  stationIds?: string[] | null
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function parseSummary(value: unknown): FuelingReportSummary | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<FuelingReportSummary>

  return {
    total_liters: toNumber(result.total_liters),
    fueling_count: toNumber(result.fueling_count),
    unique_vehicle_count: toNumber(result.unique_vehicle_count),
    average_liters_per_fueling: toNumber(result.average_liters_per_fueling),
  }
}

function parseStationRow(value: unknown): FuelingReportStationRow | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<FuelingReportStationRow>

  if (typeof result.station_id !== 'string' || typeof result.station_name !== 'string') {
    return null
  }

  return {
    station_id: result.station_id,
    station_name: result.station_name,
    total_liters: toNumber(result.total_liters),
    fueling_count: toNumber(result.fueling_count),
    unique_vehicle_count: toNumber(result.unique_vehicle_count),
  }
}

function parseFuelTypeRow(value: unknown): FuelingReportFuelTypeRow | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<FuelingReportFuelTypeRow>

  if (typeof result.fuel_type !== 'string') {
    return null
  }

  return {
    fuel_type: result.fuel_type,
    total_liters: toNumber(result.total_liters),
    fueling_count: toNumber(result.fueling_count),
    unique_vehicle_count: toNumber(result.unique_vehicle_count),
  }
}

function parseDayRow(value: unknown): FuelingReportDayRow | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<FuelingReportDayRow>

  if (typeof result.date !== 'string') {
    return null
  }

  return {
    date: result.date,
    total_liters: toNumber(result.total_liters),
    fueling_count: toNumber(result.fueling_count),
    unique_vehicle_count: toNumber(result.unique_vehicle_count),
  }
}

function hasInvalidNumbers(report: FuelingReport) {
  const numericValues = [
    report.summary.total_liters,
    report.summary.fueling_count,
    report.summary.unique_vehicle_count,
    report.summary.average_liters_per_fueling,
    ...report.by_station.flatMap((row) => [
      row.total_liters,
      row.fueling_count,
      row.unique_vehicle_count,
    ]),
    ...report.by_fuel_type.flatMap((row) => [
      row.total_liters,
      row.fueling_count,
      row.unique_vehicle_count,
    ]),
    ...report.by_day.flatMap((row) => [
      row.total_liters,
      row.fueling_count,
      row.unique_vehicle_count,
    ]),
  ]

  return numericValues.some((value) => Number.isNaN(value))
}

export function parseFuelingReport(value: unknown): FuelingReport | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<FuelingReport>
  const summary = parseSummary(result.summary)
  const byStation = Array.isArray(result.by_station)
    ? result.by_station.map(parseStationRow)
    : []
  const byFuelType = Array.isArray(result.by_fuel_type)
    ? result.by_fuel_type.map(parseFuelTypeRow)
    : []
  const byDay = Array.isArray(result.by_day) ? result.by_day.map(parseDayRow) : []

  if (
    !summary ||
    byStation.some((item) => item === null) ||
    byFuelType.some((item) => item === null) ||
    byDay.some((item) => item === null)
  ) {
    return null
  }

  const report = {
    summary,
    by_station: byStation as FuelingReportStationRow[],
    by_fuel_type: byFuelType as FuelingReportFuelTypeRow[],
    by_day: byDay as FuelingReportDayRow[],
  }

  return hasInvalidNumbers(report) ? null : report
}

export async function getFuelingReport({
  dateFrom,
  dateTo,
  stationIds = null,
}: GetFuelingReportParams): Promise<RpcResult<FuelingReport>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('get_fueling_report', {
    date_from: dateFrom,
    date_to: dateTo,
    station_ids: stationIds,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseFuelingReport(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected get_fueling_report response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
