import { isSupabaseConfigured } from '@/shared/config/env'
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
import { requestProtectedRpcApi } from './protected-api'

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

  const snapshot = (await requestProtectedRpcApi(
    '/api/vehicle-access-cache',
    { checkDate },
    'Vehicle access cache request failed.',
  )) as Record<string, unknown>
  const stations = snapshot.stations
  const vehicles = snapshot.vehicles
  const queueEntries = snapshot.queueEntries
  const allocations = snapshot.allocations
  const fuelingRecords = snapshot.fuelingRecords
  const manualOverrides = snapshot.manualOverrides
  const dailyLimitOverview = snapshot.dailyLimitOverview as
    | (Record<string, unknown> & { exists?: boolean })
    | undefined
  const refuelCooldown = snapshot.refuelCooldown
  const noShowGrace = snapshot.noShowGrace

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
      await offlineDb.local_stations.bulkPut(toRows<LocalStation>(stations))
      await offlineDb.local_vehicles.bulkPut(toRows<LocalVehicle>(vehicles))
      await offlineDb.local_reservations.bulkPut(
        toRows<SupabaseRow>(queueEntries).map((row) => {
          const allocation = toRows<SupabaseRow>(allocations).find(
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
      if (dailyLimitOverview?.exists) {
        await offlineDb.local_daily_limits.put({
          id: dailyLimitOverview.id,
          station_id: null,
          date: dailyLimitOverview.date,
          status: dailyLimitOverview.status,
          category_overviews: dailyLimitOverview.category_overviews,
          cached_at: new Date().toISOString(),
          updated_at: dailyLimitOverview.updated_at ?? undefined,
        } as LocalDailyLimit)
      }
      await offlineDb.local_fueling_records.bulkPut(
        toRows<LocalFuelingRecord>(fuelingRecords),
      )
      await offlineDb.local_manual_overrides.bulkPut(
        toRows<LocalManualOverride>(manualOverrides),
      )
      await cacheRefuelCooldownSetting(toNumber(refuelCooldown))
      await cacheNoShowGraceSetting(toNumber(noShowGrace))
    },
  )
}
