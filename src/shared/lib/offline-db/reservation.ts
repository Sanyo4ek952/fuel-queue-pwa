import { type FuelPreferenceMode, type FuelType } from '@/shared/constants'
import type { UserRole } from '@/shared/config/roles'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import { getCachedRefuelCooldownDays } from './app-settings'
import {
  offlineDb,
  type LocalFuelingRecord,
  type LocalQueueEntry,
  type LocalVehicle,
  type SyncOutboxOperation,
} from './db'

export type CreateOfflineReservationParams = {
  plateNumber: string
  driverFullName: string
  driverPhone?: string
  fuelType: FuelType
  fuelPreferenceMode?: FuelPreferenceMode
  requestedLiters: number
  comment?: string
  clientMutationId: string
  createdByProfileId?: string | null
  createdByFullName?: string | null
  createdByRole?: UserRole | string | null
  createdBySignatureName?: string | null
}

export type OfflineReservationResult = {
  id: string
  queue_entry_id: string
  permanent_number: null
  vehicle_id: string
  driver_id: string | null
  created_by_profile_id: string | null
  created_by_full_name: string
  created_by_role: UserRole | string | null
  created_by_signature_name: string | null
  normalized_plate_number: string
  driver_full_name: string
  driver_phone: string | null
  fuel_type: FuelType
  fuel_preference_mode: FuelPreferenceMode
  requested_liters: number
  status: 'WAITING'
  client_mutation_id: string
  sync_status: 'PENDING'
}

export type CreateReservationPayload = {
  plate_number: string
  driver_full_name: string
  driver_phone?: string
  fuel_type: FuelType
  fuel_preference_mode: FuelPreferenceMode
  requested_liters: number
  comment?: string
}

export function buildCreateReservationPayload({
  plateNumber,
  driverFullName,
  driverPhone,
  fuelType,
  fuelPreferenceMode,
  requestedLiters,
  comment,
}: CreateOfflineReservationParams): CreateReservationPayload {
  return {
    plate_number: normalizePlateNumber(plateNumber),
    driver_full_name: driverFullName,
    driver_phone: driverPhone || undefined,
    fuel_type: fuelType,
    fuel_preference_mode: fuelPreferenceMode ?? 'EXACT',
    requested_liters: requestedLiters,
    comment: comment || undefined,
  }
}

function makeLocalVehicle(normalizedPlateNumber: string): LocalVehicle {
  return {
    id: `local-vehicle-${normalizedPlateNumber}`,
    normalized_plate_number: normalizedPlateNumber,
    is_blocked: false,
    updated_at: new Date().toISOString(),
  }
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return toDateInputValue(date)
}

function findLastRegularFueling(records: LocalFuelingRecord[], vehicleId: string) {
  return records
    .filter((record) => record.vehicle_id === vehicleId && !record.is_manual_override)
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        right.fueled_at.localeCompare(left.fueled_at) ||
        right.id.localeCompare(left.id),
    )[0]
}

export async function createOfflineReservation({
  plateNumber,
  driverFullName,
  driverPhone,
  fuelType,
  fuelPreferenceMode = 'EXACT',
  requestedLiters,
  comment,
  clientMutationId,
  createdByProfileId,
  createdByFullName,
  createdByRole,
  createdBySignatureName,
}: CreateOfflineReservationParams): Promise<OfflineReservationResult> {
  const queueEntriesTable = offlineDb.local_queue_entries ?? offlineDb.local_reservations
  const normalizedPlateNumber = normalizePlateNumber(plateNumber)
  const trimmedDriverFullName = driverFullName.trim()
  const trimmedDriverPhone = driverPhone?.trim() || null
  const trimmedComment = comment?.trim() || null

  if (!normalizedPlateNumber) {
    throw new Error('INVALID_PLATE_NUMBER')
  }

  if (!trimmedDriverFullName) {
    throw new Error('INVALID_DRIVER_FULL_NAME')
  }

  if (!trimmedDriverPhone) {
    throw new Error('INVALID_DRIVER_PHONE')
  }

  if (requestedLiters <= 0) {
    throw new Error('INVALID_REQUESTED_LITERS')
  }

  const [vehicles, queueEntries, fuelingRecords, cooldownDays] = await Promise.all([
    offlineDb.local_vehicles.toArray(),
    queueEntriesTable.toArray(),
    offlineDb.local_fueling_records.toArray(),
    getCachedRefuelCooldownDays(),
  ])
  const existingVehicle = vehicles.find(
    (vehicle) => vehicle.normalized_plate_number === normalizedPlateNumber,
  )
  const vehicle = existingVehicle ?? makeLocalVehicle(normalizedPlateNumber)

  if (vehicle.is_blocked) {
    throw new Error('VEHICLE_BLOCKED')
  }

  if (cooldownDays > 0) {
    const lastFueling = findLastRegularFueling(fuelingRecords, vehicle.id)

    if (lastFueling) {
      const today = toDateInputValue(new Date())
      const nextAllowedDate = addDays(lastFueling.date, cooldownDays)

      if (today < nextAllowedDate) {
        throw new Error('REFUEL_COOLDOWN_ACTIVE')
      }
    }
  }

  const duplicateReservation = queueEntries.find(
    (entry) =>
      entry.vehicle_id === vehicle.id &&
      ['WAITING', 'RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'].includes(entry.status),
  )

  if (duplicateReservation) {
    throw new Error('ACTIVE_RESERVATION_ALREADY_EXISTS')
  }

  const id = `local-${clientMutationId}`
  const now = new Date().toISOString()
  const localQueueEntry: LocalQueueEntry = {
    id,
    vehicle_id: vehicle.id,
    preferred_fuel_type: fuelType,
    fuel_preference_mode: fuelPreferenceMode,
    requested_liters: requestedLiters,
    status: 'WAITING',
    normalized_plate_number: normalizedPlateNumber,
    driver_full_name: trimmedDriverFullName,
    driver_phone: trimmedDriverPhone,
    comment: trimmedComment,
    client_mutation_id: clientMutationId,
    sync_status: 'PENDING',
    updated_at: now,
  }
  const syncOutboxOperation: SyncOutboxOperation = {
    id: clientMutationId,
    client_mutation_id: clientMutationId,
    type: 'CREATE_RESERVATION',
    payload: buildCreateReservationPayload({
      plateNumber,
      driverFullName,
      driverPhone: trimmedDriverPhone ?? undefined,
      fuelType,
      fuelPreferenceMode,
      requestedLiters,
      comment: trimmedComment ?? undefined,
      clientMutationId,
    }),
    status: 'PENDING',
    created_at: now,
    retry_count: 0,
  }

  await offlineDb.transaction(
    'rw',
    [offlineDb.local_vehicles, queueEntriesTable, offlineDb.sync_outbox],
    async () => {
      if (!existingVehicle) {
        await offlineDb.local_vehicles.put(vehicle)
      }

      await queueEntriesTable.put(localQueueEntry as never)
      await offlineDb.sync_outbox.put(syncOutboxOperation)
    },
  )

  return {
    id,
    queue_entry_id: id,
    permanent_number: null,
    vehicle_id: vehicle.id,
    driver_id: null,
    created_by_profile_id: createdByProfileId ?? null,
    created_by_full_name: createdByFullName ?? '',
    created_by_role: createdByRole ?? null,
    created_by_signature_name: createdBySignatureName ?? null,
    normalized_plate_number: normalizedPlateNumber,
    driver_full_name: trimmedDriverFullName,
    driver_phone: trimmedDriverPhone,
    fuel_type: fuelType,
    fuel_preference_mode: fuelPreferenceMode,
    requested_liters: requestedLiters,
    status: 'WAITING',
    client_mutation_id: clientMutationId,
    sync_status: 'PENDING',
  }
}
