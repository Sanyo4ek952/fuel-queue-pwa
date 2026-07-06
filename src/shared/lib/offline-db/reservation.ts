import type { FuelType } from '@/shared/constants'
import type { UserRole } from '@/shared/config/roles'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import { getCachedRefuelCooldownDays } from './app-settings'
import {
  offlineDb,
  type LocalFuelingRecord,
  type LocalReservation,
  type LocalVehicle,
  type SyncOutboxOperation,
} from './db'

const activeReservationStatuses = new Set(['RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'])

export type CreateOfflineReservationParams = {
  plateNumber: string
  driverFullName: string
  driverPhone?: string
  fuelType: FuelType
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
  date: string | null
  station_id: string | null
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
  requested_liters: number
  queue_number: number
  status: 'RESERVED'
  client_mutation_id: string
  sync_status: 'PENDING'
}

export type CreateReservationPayload = {
  plate_number: string
  driver_full_name: string
  driver_phone?: string
  fuel_type: FuelType
  requested_liters: number
  comment?: string
}

export function buildCreateReservationPayload({
  plateNumber,
  driverFullName,
  driverPhone,
  fuelType,
  requestedLiters,
  comment,
}: CreateOfflineReservationParams): CreateReservationPayload {
  return {
    plate_number: normalizePlateNumber(plateNumber),
    driver_full_name: driverFullName,
    driver_phone: driverPhone || undefined,
    fuel_type: fuelType,
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
  requestedLiters,
  comment,
  clientMutationId,
  createdByProfileId,
  createdByFullName,
  createdByRole,
  createdBySignatureName,
}: CreateOfflineReservationParams): Promise<OfflineReservationResult> {
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

  if (requestedLiters <= 0) {
    throw new Error('INVALID_REQUESTED_LITERS')
  }

  const [vehicles, reservations, fuelingRecords, cooldownDays] = await Promise.all([
    offlineDb.local_vehicles.toArray(),
    offlineDb.local_reservations.toArray(),
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

  const duplicateReservation = reservations.find(
    (reservation) =>
      reservation.vehicle_id === vehicle.id &&
      activeReservationStatuses.has(reservation.status),
  )

  if (duplicateReservation) {
    throw new Error('ACTIVE_RESERVATION_ALREADY_EXISTS')
  }

  const nextQueueNumber =
    Math.max(0, ...reservations.map((reservation) => reservation.queue_number)) + 1
  const id = `local-${clientMutationId}`
  const now = new Date().toISOString()
  const localReservation: LocalReservation = {
    id,
    date: null,
    station_id: null,
    vehicle_id: vehicle.id,
    driver_id: null,
    created_by_profile_id: createdByProfileId ?? null,
    created_by_full_name: createdByFullName ?? '',
    created_by_role: createdByRole ?? null,
    created_by_signature_name: createdBySignatureName ?? null,
    fuel_type: fuelType,
    requested_liters: requestedLiters,
    queue_number: nextQueueNumber,
    status: 'RESERVED',
    normalized_plate_number: normalizedPlateNumber,
    driver_full_name: trimmedDriverFullName,
    driver_phone: trimmedDriverPhone,
    comment: trimmedComment,
    client_mutation_id: clientMutationId,
    sync_status: 'PENDING',
    created_at: now,
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
    [offlineDb.local_vehicles, offlineDb.local_reservations, offlineDb.sync_outbox],
    async () => {
      if (!existingVehicle) {
        await offlineDb.local_vehicles.put(vehicle)
      }

      await offlineDb.local_reservations.put(localReservation)
      await offlineDb.sync_outbox.put(syncOutboxOperation)
    },
  )

  return {
    id,
    date: null,
    station_id: null,
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
    requested_liters: requestedLiters,
    queue_number: nextQueueNumber,
    status: 'RESERVED',
    client_mutation_id: clientMutationId,
    sync_status: 'PENDING',
  }
}
