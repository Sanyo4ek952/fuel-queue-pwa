import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import {
  type LocalDailyLimit,
  type LocalFuelingRecord,
  type LocalManualOverride,
  type LocalReservation,
  type LocalStation,
  type LocalVehicle,
  offlineDb,
} from '@/shared/lib/offline-db'
import type { CheckVehicleAccessParams } from '@/shared/types/vehicle-access'

type SupabaseRow = Record<string, unknown>

function toRows<TRecord>(value: unknown): TRecord[] {
  return Array.isArray(value) ? (value as TRecord[]) : []
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

export async function refreshVehicleAccessCache({
  stationId,
  checkDate,
}: Pick<CheckVehicleAccessParams, 'stationId' | 'checkDate'>) {
  if (!isSupabaseConfigured) {
    return
  }

  const [
    stationsResult,
    vehiclesResult,
    reservationsResult,
    dailyLimitsResult,
    fuelingRecordsResult,
    manualOverridesResult,
  ] = await Promise.all([
    supabase.from('stations').select('id,name,address,is_active,updated_at').eq('is_active', true),
    supabase
      .from('vehicles')
      .select('id,normalized_plate_number,is_blocked,block_reason,updated_at'),
    supabase
      .from('fuel_reservations')
      .select(
        'id,station_id,vehicle_id,date,status,queue_number,fuel_type,requested_liters,created_at,updated_at',
      )
      .eq('date', checkDate),
    supabase
      .from('daily_limits')
      .select('id,station_id,date,status,max_liters_per_vehicle,updated_at')
      .eq('station_id', stationId)
      .eq('date', checkDate),
    supabase
      .from('fueling_records')
      .select('id,station_id,vehicle_id,date,fueled_at,is_manual_override,updated_at')
      .eq('date', checkDate),
    supabase
      .from('manual_overrides')
      .select('id,station_id,vehicle_id,date,used_at,expires_at,updated_at')
      .eq('date', checkDate),
  ])

  const firstError =
    stationsResult.error ??
    vehiclesResult.error ??
    reservationsResult.error ??
    dailyLimitsResult.error ??
    fuelingRecordsResult.error ??
    manualOverridesResult.error

  if (firstError) {
    throw new Error(firstError.message)
  }

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.local_stations,
      offlineDb.local_vehicles,
      offlineDb.local_reservations,
      offlineDb.local_daily_limits,
      offlineDb.local_fueling_records,
      offlineDb.local_manual_overrides,
    ],
    async () => {
      await offlineDb.local_stations.bulkPut(toRows<LocalStation>(stationsResult.data))
      await offlineDb.local_vehicles.bulkPut(toRows<LocalVehicle>(vehiclesResult.data))
      await offlineDb.local_reservations.bulkPut(
        toRows<SupabaseRow>(reservationsResult.data).map((row) => ({
          ...row,
          requested_liters: toNumber(row.requested_liters),
        })) as LocalReservation[],
      )
      await offlineDb.local_daily_limits.bulkPut(
        toRows<SupabaseRow>(dailyLimitsResult.data).map((row) => ({
          ...row,
          max_liters_per_vehicle: toNumber(row.max_liters_per_vehicle),
        })) as LocalDailyLimit[],
      )
      await offlineDb.local_fueling_records.bulkPut(
        toRows<LocalFuelingRecord>(fuelingRecordsResult.data),
      )
      await offlineDb.local_manual_overrides.bulkPut(
        toRows<LocalManualOverride>(manualOverridesResult.data),
      )
    },
  )
}
