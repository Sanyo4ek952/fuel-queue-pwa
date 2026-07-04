import {
  type CheckVehicleAccessParams,
  type VehicleAccessReason,
  type VehicleAccessResult,
} from '@/shared/types/vehicle-access'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import {
  type LocalDailyLimit,
  type LocalFuelingRecord,
  type LocalManualOverride,
  type LocalReservation,
  type LocalVehicle,
  offlineDb,
} from './db'

const activeReservationStatuses = new Set(['RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'])

export type OfflineVehicleAccessSnapshot = {
  vehicles: LocalVehicle[]
  reservations: LocalReservation[]
  dailyLimits: LocalDailyLimit[]
  fuelingRecords: LocalFuelingRecord[]
  manualOverrides: LocalManualOverride[]
}

function isFutureOrOpen(expiresAt?: string | null) {
  return !expiresAt || new Date(expiresAt).getTime() > Date.now()
}

function makeBlockedResult(
  reason: VehicleAccessReason,
  normalizedPlateNumber: string,
  extra: Partial<VehicleAccessResult> = {},
): VehicleAccessResult {
  return {
    status: 'BLOCKED',
    reason,
    normalized_plate_number: normalizedPlateNumber,
    ...extra,
  }
}

export function markOfflineResult(
  result: VehicleAccessResult,
  error?: string,
): VehicleAccessResult {
  return {
    ...result,
    status: 'WARNING',
    reason: 'OFFLINE_UNCONFIRMED',
    offline: true,
    offline_decision: result.status === 'ALLOWED' ? 'ALLOWED' : 'BLOCKED',
    offline_reason: result.reason,
    error,
  }
}

export function evaluateVehicleAccessOffline(
  { plateNumber, stationId, checkDate }: CheckVehicleAccessParams,
  snapshot: OfflineVehicleAccessSnapshot,
): VehicleAccessResult {
  const normalizedPlateNumber = normalizePlateNumber(plateNumber)

  if (!normalizedPlateNumber) {
    return makeBlockedResult('INVALID_PLATE_NUMBER', normalizedPlateNumber, {
      station_id: stationId,
      date: checkDate,
    })
  }

  const vehicle = snapshot.vehicles.find(
    (item) => item.normalized_plate_number === normalizedPlateNumber,
  )

  if (!vehicle) {
    return makeBlockedResult('NO_ACTIVE_RESERVATION', normalizedPlateNumber, {
      station_id: stationId,
      date: checkDate,
    })
  }

  const manualOverride = snapshot.manualOverrides.find(
    (override) =>
      override.vehicle_id === vehicle.id &&
      override.station_id === stationId &&
      override.date === checkDate &&
      !override.used_at &&
      isFutureOrOpen(override.expires_at),
  )

  if (vehicle.is_blocked && !manualOverride) {
    return makeBlockedResult('VEHICLE_BLOCKED', normalizedPlateNumber, {
      vehicle_id: vehicle.id,
      block_reason: vehicle.block_reason,
    })
  }

  const lastFueling = snapshot.fuelingRecords.find(
    (record) =>
      record.vehicle_id === vehicle.id &&
      record.date === checkDate &&
      !record.is_manual_override,
  )

  if (lastFueling && !manualOverride) {
    return makeBlockedResult('ALREADY_FUELED', normalizedPlateNumber, {
      vehicle_id: vehicle.id,
      last_fueling_record_id: lastFueling.id,
      last_fueling_station_id: lastFueling.station_id,
      last_fueled_at: lastFueling.fueled_at,
    })
  }

  const reservation = snapshot.reservations.find(
    (item) =>
      item.vehicle_id === vehicle.id &&
      item.date === checkDate &&
      item.station_id === stationId &&
      activeReservationStatuses.has(item.status),
  )

  if (!reservation) {
    const otherReservation = snapshot.reservations.find(
      (item) =>
        item.vehicle_id === vehicle.id &&
        item.date === checkDate &&
        activeReservationStatuses.has(item.status),
    )

    if (manualOverride) {
      return {
        status: 'ALLOWED',
        reason: 'MANUAL_OVERRIDE_ACTIVE',
        normalized_plate_number: normalizedPlateNumber,
        vehicle_id: vehicle.id,
        manual_override_id: manualOverride.id,
        station_id: stationId,
        date: checkDate,
      }
    }

    if (otherReservation) {
      return makeBlockedResult('RESERVATION_AT_OTHER_STATION', normalizedPlateNumber, {
        vehicle_id: vehicle.id,
        reservation_id: otherReservation.id,
        reservation_station_id: otherReservation.station_id,
        date: checkDate,
      })
    }

    return makeBlockedResult('NO_ACTIVE_RESERVATION', normalizedPlateNumber, {
      vehicle_id: vehicle.id,
      station_id: stationId,
      date: checkDate,
    })
  }

  const dailyLimit = snapshot.dailyLimits.find(
    (item) => item.station_id === stationId && item.date === checkDate,
  )

  if (!dailyLimit) {
    return makeBlockedResult('NO_DAILY_LIMIT', normalizedPlateNumber, {
      vehicle_id: vehicle.id,
      reservation_id: reservation.id,
      station_id: stationId,
      date: checkDate,
    })
  }

  if (dailyLimit.status !== 'OPEN' && !manualOverride) {
    return makeBlockedResult('DAILY_LIMIT_NOT_OPEN', normalizedPlateNumber, {
      vehicle_id: vehicle.id,
      reservation_id: reservation.id,
      daily_limit_id: dailyLimit.id,
      daily_limit_status: dailyLimit.status,
    })
  }

  if (reservation.requested_liters > dailyLimit.max_liters_per_vehicle && !manualOverride) {
    return makeBlockedResult('LITERS_LIMIT_EXCEEDED', normalizedPlateNumber, {
      vehicle_id: vehicle.id,
      reservation_id: reservation.id,
      requested_liters: reservation.requested_liters,
      max_liters_per_vehicle: dailyLimit.max_liters_per_vehicle,
    })
  }

  return {
    status: 'ALLOWED',
    reason: manualOverride ? 'MANUAL_OVERRIDE_ACTIVE' : 'ACTIVE_RESERVATION',
    normalized_plate_number: normalizedPlateNumber,
    vehicle_id: vehicle.id,
    reservation_id: reservation.id,
    station_id: stationId,
    date: checkDate,
    queue_number: reservation.queue_number,
    fuel_type: reservation.fuel_type,
    requested_liters: reservation.requested_liters,
    manual_override_id: manualOverride?.id,
  }
}

export async function checkVehicleAccessOffline(
  params: CheckVehicleAccessParams,
): Promise<VehicleAccessResult> {
  const [vehicles, reservations, dailyLimits, fuelingRecords, manualOverrides] = await Promise.all([
    offlineDb.local_vehicles.toArray(),
    offlineDb.local_reservations.toArray(),
    offlineDb.local_daily_limits.toArray(),
    offlineDb.local_fueling_records.toArray(),
    offlineDb.local_manual_overrides.toArray(),
  ])

  return evaluateVehicleAccessOffline(params, {
    vehicles,
    reservations,
    dailyLimits,
    fuelingRecords,
    manualOverrides,
  })
}
