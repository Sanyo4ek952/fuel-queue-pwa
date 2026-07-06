import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
import type {
  GetVehicleFuelingHistoryParams,
  VehicleFuelingHistoryFuelSummary,
  VehicleFuelingHistoryRecord,
  VehicleFuelingHistoryResult,
  VehicleFuelingHistoryStationSummary,
} from '@/shared/types/vehicle-fueling-history'

import type { RpcResult } from './index'

export type { GetVehicleFuelingHistoryParams, VehicleFuelingHistoryResult }

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function parseStationSummary(value: unknown): VehicleFuelingHistoryStationSummary | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<VehicleFuelingHistoryStationSummary>

  if (typeof result.station_id !== 'string' || typeof result.station_name !== 'string') {
    return null
  }

  return {
    station_id: result.station_id,
    station_name: result.station_name,
    fueling_count: toNumber(result.fueling_count),
    total_liters: toNumber(result.total_liters),
  }
}

function parseFuelSummary(value: unknown): VehicleFuelingHistoryFuelSummary | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<VehicleFuelingHistoryFuelSummary>

  if (typeof result.fuel_type !== 'string') {
    return null
  }

  return {
    fuel_type: result.fuel_type,
    fueling_count: toNumber(result.fueling_count),
    total_liters: toNumber(result.total_liters),
  }
}

function parseFuelingRecord(value: unknown): VehicleFuelingHistoryRecord | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<VehicleFuelingHistoryRecord>

  if (
    typeof result.id !== 'string' ||
    typeof result.date !== 'string' ||
    typeof result.fueled_at !== 'string' ||
    typeof result.station_id !== 'string' ||
    typeof result.station_name !== 'string' ||
    typeof result.fuel_type !== 'string' ||
    typeof result.is_manual_override !== 'boolean' ||
    typeof result.sync_status !== 'string'
  ) {
    return null
  }

  return {
    id: result.id,
    date: result.date,
    fueled_at: result.fueled_at,
    liters: toNumber(result.liters),
    station_id: result.station_id,
    station_name: result.station_name,
    fuel_type: result.fuel_type,
    is_manual_override: result.is_manual_override,
    sync_status: result.sync_status,
  }
}

export function parseVehicleFuelingHistory(
  value: unknown,
): VehicleFuelingHistoryResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<VehicleFuelingHistoryResult>

  if (
    typeof result.normalized_plate_number !== 'string' ||
    typeof result.vehicle_found !== 'boolean'
  ) {
    return null
  }

  const stationSummaries = Array.isArray(result.station_summaries)
    ? result.station_summaries.map(parseStationSummary)
    : []
  const fuelTypeSummaries = Array.isArray(result.fuel_type_summaries)
    ? result.fuel_type_summaries.map(parseFuelSummary)
    : []
  const records = Array.isArray(result.records) ? result.records.map(parseFuelingRecord) : []

  if (
    stationSummaries.some((item) => item === null) ||
    fuelTypeSummaries.some((item) => item === null) ||
    records.some((item) => item === null)
  ) {
    return null
  }

  return {
    normalized_plate_number: result.normalized_plate_number,
    vehicle_id: result.vehicle_id ?? null,
    vehicle_found: result.vehicle_found,
    total_fueling_count: toNumber(result.total_fueling_count),
    regular_fueling_count: toNumber(result.regular_fueling_count),
    manual_override_fueling_count: toNumber(result.manual_override_fueling_count),
    total_liters: toNumber(result.total_liters),
    first_fueled_at: result.first_fueled_at ?? null,
    last_fueled_at: result.last_fueled_at ?? null,
    station_summaries: stationSummaries as VehicleFuelingHistoryStationSummary[],
    fuel_type_summaries: fuelTypeSummaries as VehicleFuelingHistoryFuelSummary[],
    records: records as VehicleFuelingHistoryRecord[],
    has_more: result.has_more === true,
  }
}

export async function getVehicleFuelingHistory({
  plateNumber,
  pageLimit = 10,
  pageOffset = 0,
}: GetVehicleFuelingHistoryParams): Promise<RpcResult<VehicleFuelingHistoryResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('get_vehicle_fueling_history', {
    plate_number: normalizePlateNumber(plateNumber),
    page_limit: pageLimit,
    page_offset: pageOffset,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseVehicleFuelingHistory(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected get_vehicle_fueling_history response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
