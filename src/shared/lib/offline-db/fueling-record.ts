import type { FuelType } from '@/shared/constants'
import type { VehicleAccessResult } from '@/shared/types/vehicle-access'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import { evaluateVehicleAccessOffline } from './vehicle-access'
import { offlineDb, type LocalFuelingRecord, type SyncOutboxOperation } from './db'

export type CreateOfflineFuelingRecordParams = {
  stationId: string
  plateNumber: string
  liters: number
  fuelType?: FuelType
  targetDate: string
  fueledAt: string
  comment?: string
  clientMutationId: string
}

export type OfflineFuelingRecordResult = {
  id: string
  date: string
  station_id: string
  vehicle_id: string
  reservation_id: string | null
  preferential_queue_entry_id: null
  fuel_type: FuelType
  liters: number
  is_manual_override: boolean
  override_id: string | null
  client_mutation_id: string
  sync_status: 'PENDING'
  fueled_at: string
}

export type CreateFuelingRecordPayload = {
  station_id: string
  plate_number: string
  liters: number
  fuel_type?: FuelType
  target_date: string
  fueled_at: string
  comment?: string
}

export function buildCreateFuelingRecordPayload({
  stationId,
  plateNumber,
  liters,
  fuelType,
  targetDate,
  fueledAt,
  comment,
}: CreateOfflineFuelingRecordParams): CreateFuelingRecordPayload {
  return {
    station_id: stationId,
    plate_number: normalizePlateNumber(plateNumber),
    liters,
    fuel_type: fuelType,
    target_date: targetDate,
    fueled_at: fueledAt,
    comment: comment || undefined,
  }
}

function isAllowedForOfflineFueling(result: VehicleAccessResult) {
  return result.status === 'ALLOWED'
}

export async function createOfflineFuelingRecord({
  stationId,
  plateNumber,
  liters,
  fuelType,
  targetDate,
  fueledAt,
  comment,
  clientMutationId,
}: CreateOfflineFuelingRecordParams): Promise<OfflineFuelingRecordResult> {
  const [vehicles, reservations, dailyLimits, fuelingRecords, manualOverrides] = await Promise.all([
    offlineDb.local_vehicles.toArray(),
    offlineDb.local_reservations.toArray(),
    offlineDb.local_daily_limits.toArray(),
    offlineDb.local_fueling_records.toArray(),
    offlineDb.local_manual_overrides.toArray(),
  ])

  const accessResult = evaluateVehicleAccessOffline(
    {
      stationId,
      plateNumber,
      checkDate: targetDate,
    },
    {
      vehicles,
      reservations,
      dailyLimits,
      fuelingRecords,
      manualOverrides,
    },
  )

  if (!isAllowedForOfflineFueling(accessResult)) {
    throw new Error(accessResult.reason)
  }

  const vehicleId = accessResult.vehicle_id
  const effectiveFuelType = (accessResult.matched_fuel_type ??
    accessResult.fuel_type ??
    fuelType) as FuelType | undefined

  if (!vehicleId) {
    throw new Error('VEHICLE_NOT_FOUND')
  }

  if (!effectiveFuelType) {
    throw new Error('INVALID_FUEL_TYPE')
  }

  const id = `local-${clientMutationId}`
  const now = new Date().toISOString()
  const isManualOverride = accessResult.reason === 'MANUAL_OVERRIDE_ACTIVE'
  const localFuelingRecord: LocalFuelingRecord = {
    id,
    station_id: stationId,
    vehicle_id: vehicleId,
    date: targetDate,
    reservation_id: accessResult.reservation_id ?? null,
    fuel_type: effectiveFuelType,
    liters,
    fueled_at: fueledAt,
    is_manual_override: isManualOverride,
    override_id: accessResult.manual_override_id ?? null,
    comment: comment || null,
    client_mutation_id: clientMutationId,
    sync_status: 'PENDING',
    updated_at: now,
  }
  const syncOutboxOperation: SyncOutboxOperation = {
    id: clientMutationId,
    client_mutation_id: clientMutationId,
    type: 'CREATE_FUELING_RECORD',
    payload: buildCreateFuelingRecordPayload({
      stationId,
      plateNumber,
      liters,
      fuelType: effectiveFuelType,
      targetDate,
      fueledAt,
      comment,
      clientMutationId,
    }),
    status: 'PENDING',
    created_at: now,
    retry_count: 0,
  }

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.local_fueling_records,
      offlineDb.local_reservations,
      offlineDb.local_manual_overrides,
      offlineDb.sync_outbox,
    ],
    async () => {
      await offlineDb.local_fueling_records.put(localFuelingRecord)

      if (accessResult.reservation_id) {
        await offlineDb.local_reservations.update(accessResult.reservation_id, {
          status: 'FUELED',
          updated_at: now,
        })
      }

      if (accessResult.manual_override_id) {
        await offlineDb.local_manual_overrides.update(accessResult.manual_override_id, {
          used_at: fueledAt,
          updated_at: now,
        })
      }

      await offlineDb.sync_outbox.put(syncOutboxOperation)
    },
  )

  return {
    id,
    date: targetDate,
    station_id: stationId,
    vehicle_id: vehicleId,
    reservation_id: accessResult.reservation_id ?? null,
    preferential_queue_entry_id: null,
    fuel_type: effectiveFuelType,
    liters,
    is_manual_override: isManualOverride,
    override_id: accessResult.manual_override_id ?? null,
    client_mutation_id: clientMutationId,
    sync_status: 'PENDING',
    fueled_at: fueledAt,
  }
}
