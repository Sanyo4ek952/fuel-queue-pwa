import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import {
  type LocalDailyLimit,
  type LocalFuelingRecord,
  type LocalManualOverride,
  type LocalReservation,
  type LocalStation,
  type LocalVehicle,
  cacheNoShowGraceSetting,
  cacheRefuelCooldownSetting,
  offlineDb,
} from '@/shared/lib/offline-db'
import type { CheckVehicleAccessParams } from '@/shared/types/vehicle-access'
import { getDailyLimitOverview } from './get-daily-limit-overview'

type SupabaseRow = Record<string, unknown>

function toRows<TRecord>(value: unknown): TRecord[] {
  return Array.isArray(value) ? (value as TRecord[]) : []
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

export async function refreshVehicleAccessCache({
  checkDate,
}: Pick<CheckVehicleAccessParams, 'checkDate'>) {
  if (!isSupabaseConfigured) {
    return
  }

  const [
    stationsResult,
    vehiclesResult,
    queueEntriesResult,
    allocationsResult,
    fuelingRecordsResult,
    manualOverridesResult,
    dailyLimitOverviewResult,
    refuelCooldownResult,
    noShowGraceResult,
  ] = await Promise.all([
    supabase.from('stations').select('id,name,address,is_active,updated_at').eq('is_active', true),
    supabase
      .from('vehicles')
      .select('id,normalized_plate_number,is_blocked,block_reason,updated_at'),
    supabase
      .from('fuel_queue_entries')
      .select(
        'id,permanent_number,vehicle_id,driver_id,status,preferred_fuel_type,fuel_preference_mode,requested_liters,comment,client_mutation_id,sync_status,created_at,updated_at,vehicles(normalized_plate_number),drivers(full_name,phone)',
      )
      .eq('status', 'WAITING'),
    supabase
      .from('daily_queue_allocations')
      .select('id,queue_entry_id,allocation_date,station_id,assigned_fuel_type,allocated_liters,daily_position,station_position,station_fuel_position,arrival_at,status,call_status,updated_at')
      .eq('allocation_date', checkDate),
    supabase
      .from('fueling_records')
      .select('id,station_id,vehicle_id,date,fueled_at,is_manual_override,updated_at')
      .order('fueled_at', { ascending: false })
      .limit(500),
    supabase
      .from('manual_overrides')
      .select(
        'id,station_id,vehicle_id,date,reason,approved_by,used_at,expires_at,client_mutation_id,sync_status,updated_at',
      )
      .eq('date', checkDate),
    getDailyLimitOverview({ date: checkDate }),
    supabase.rpc('get_reservation_refuel_cooldown'),
    supabase.rpc('get_reservation_no_show_grace_days'),
  ])

  const firstError =
    stationsResult.error ??
    vehiclesResult.error ??
    queueEntriesResult.error ??
    allocationsResult.error ??
    fuelingRecordsResult.error ??
    manualOverridesResult.error ??
    (dailyLimitOverviewResult.error ? new Error(dailyLimitOverviewResult.error) : null) ??
    refuelCooldownResult.error ??
    noShowGraceResult.error

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
      offlineDb.local_app_settings,
    ],
    async () => {
      await offlineDb.local_stations.bulkPut(toRows<LocalStation>(stationsResult.data))
      await offlineDb.local_vehicles.bulkPut(toRows<LocalVehicle>(vehiclesResult.data))
      await offlineDb.local_reservations.bulkPut(
        toRows<SupabaseRow>(queueEntriesResult.data).map((row) => {
          const allocation = toRows<SupabaseRow>(allocationsResult.data).find(
            (candidate) => candidate.queue_entry_id === row.id,
          )
          const allocationStatus = allocation?.status
          const activeAssignedFuelType =
            allocationStatus === 'ACTIVE' ? allocation?.assigned_fuel_type : undefined
          return ({
          ...row,
          id: allocation?.id ?? row.id,
          allocation_id: allocation?.id,
          queue_entry_id: row.id,
          queue_number: toNumber(row.permanent_number),
          ticket_number: toNumber(row.permanent_number),
          fuel_type: row.preferred_fuel_type,
          date: allocation?.allocation_date,
          station_id: allocation?.station_id,
          assigned_fuel_type: activeAssignedFuelType,
          matched_fuel_type: activeAssignedFuelType,
          daily_position: allocation?.daily_position,
          current_position: allocation?.daily_position,
          station_position: allocation?.station_position,
          station_fuel_position: allocation?.station_fuel_position,
          arrival_at: allocation?.arrival_at,
          allocation_status: allocationStatus,
          is_within_today_limit: allocationStatus === 'ACTIVE',
          is_callable_now: allocationStatus === 'ACTIVE',
          latest_call_status: allocation?.call_status,
          normalized_plate_number:
            typeof row.vehicles === 'object' && row.vehicles && !Array.isArray(row.vehicles)
              ? (row.vehicles as SupabaseRow).normalized_plate_number
              : undefined,
          driver_full_name:
            typeof row.drivers === 'object' && row.drivers && !Array.isArray(row.drivers)
              ? (row.drivers as SupabaseRow).full_name
              : undefined,
          driver_phone:
            typeof row.drivers === 'object' && row.drivers && !Array.isArray(row.drivers)
              ? (row.drivers as SupabaseRow).phone
              : undefined,
          requested_liters: toNumber(row.requested_liters),
        })}) as LocalReservation[],
      )
      if (dailyLimitOverviewResult.data?.exists) {
        await offlineDb.local_daily_limits.put({
          id: dailyLimitOverviewResult.data.id,
          station_id: null,
          date: dailyLimitOverviewResult.data.date,
          status: dailyLimitOverviewResult.data.status,
          category_overviews: dailyLimitOverviewResult.data.category_overviews,
          cached_at: new Date().toISOString(),
          updated_at: dailyLimitOverviewResult.data.updated_at ?? undefined,
        } as LocalDailyLimit)
      }
      await offlineDb.local_fueling_records.bulkPut(
        toRows<LocalFuelingRecord>(fuelingRecordsResult.data),
      )
      await offlineDb.local_manual_overrides.bulkPut(
        toRows<LocalManualOverride>(manualOverridesResult.data),
      )
      await cacheRefuelCooldownSetting(toNumber(refuelCooldownResult.data))
      await cacheNoShowGraceSetting(toNumber(noShowGraceResult.data))
    },
  )
}
