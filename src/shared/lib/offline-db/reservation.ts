import type { FuelType } from '@/shared/constants'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import { offlineDb, type LocalReservation, type LocalVehicle, type SyncOutboxOperation } from './db'

const activeReservationStatuses = new Set(['RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'])

export type CreateOfflineReservationParams = {
  targetDate: string
  stationId: string
  plateNumber: string
  driverFullName: string
  driverPhone?: string
  fuelType: FuelType
  requestedLiters: number
  comment?: string
  clientMutationId: string
}

export type OfflineReservationResult = {
  id: string
  date: string
  station_id: string
  vehicle_id: string
  driver_id: string | null
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
  target_date: string
  station_id: string
  plate_number: string
  driver_full_name: string
  driver_phone?: string
  fuel_type: FuelType
  requested_liters: number
  comment?: string
}

export function buildCreateReservationPayload({
  targetDate,
  stationId,
  plateNumber,
  driverFullName,
  driverPhone,
  fuelType,
  requestedLiters,
  comment,
}: CreateOfflineReservationParams): CreateReservationPayload {
  return {
    target_date: targetDate,
    station_id: stationId,
    plate_number: plateNumber,
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

export async function createOfflineReservation({
  targetDate,
  stationId,
  plateNumber,
  driverFullName,
  driverPhone,
  fuelType,
  requestedLiters,
  comment,
  clientMutationId,
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

  const [vehicles, reservations, dailyLimits] = await Promise.all([
    offlineDb.local_vehicles.toArray(),
    offlineDb.local_reservations.toArray(),
    offlineDb.local_daily_limits.toArray(),
  ])
  const existingVehicle = vehicles.find(
    (vehicle) => vehicle.normalized_plate_number === normalizedPlateNumber,
  )
  const vehicle = existingVehicle ?? makeLocalVehicle(normalizedPlateNumber)

  if (vehicle.is_blocked) {
    throw new Error('VEHICLE_BLOCKED')
  }

  const duplicateReservation = reservations.find(
    (reservation) =>
      reservation.vehicle_id === vehicle.id &&
      reservation.date === targetDate &&
      activeReservationStatuses.has(reservation.status),
  )

  if (duplicateReservation) {
    throw new Error('ACTIVE_RESERVATION_ALREADY_EXISTS')
  }

  const dailyLimit = dailyLimits.find(
    (limit) => limit.station_id === stationId && limit.date === targetDate,
  )

  if (dailyLimit) {
    if (dailyLimit.status !== 'OPEN') {
      throw new Error('DAILY_LIMIT_NOT_OPEN')
    }

    if (requestedLiters > dailyLimit.max_liters_per_vehicle) {
      throw new Error('LITERS_LIMIT_EXCEEDED')
    }
  }

  const nextQueueNumber =
    Math.max(
      0,
      ...reservations
        .filter((reservation) => reservation.station_id === stationId && reservation.date === targetDate)
        .map((reservation) => reservation.queue_number),
    ) + 1
  const id = `local-${clientMutationId}`
  const now = new Date().toISOString()
  const localReservation: LocalReservation = {
    id,
    date: targetDate,
    station_id: stationId,
    vehicle_id: vehicle.id,
    driver_id: null,
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
      targetDate,
      stationId,
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
    date: targetDate,
    station_id: stationId,
    vehicle_id: vehicle.id,
    driver_id: null,
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
