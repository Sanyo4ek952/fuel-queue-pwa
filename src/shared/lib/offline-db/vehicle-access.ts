import {
  type CheckVehicleAccessParams,
  type VehicleAccessReason,
  type VehicleAccessResult,
} from '@/shared/types/vehicle-access'
import { getFuelQueueCategory } from '@/shared/constants'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import { getCachedRefuelCooldownDays } from './app-settings'
import {
  type LocalDailyLimit,
  type LocalFuelingRecord,
  type LocalManualOverride,
  type LocalReservation,
  type LocalVehicle,
  offlineDb,
} from './db'

export type OfflineVehicleAccessSnapshot = {
  vehicles: LocalVehicle[]
  reservations: LocalReservation[]
  dailyLimits: LocalDailyLimit[]
  fuelingRecords: LocalFuelingRecord[]
  manualOverrides: LocalManualOverride[]
  cooldownDays?: number
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

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
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

  const cooldownDays = snapshot.cooldownDays ?? 0
  const lastRegularFueling = findLastRegularFueling(snapshot.fuelingRecords, vehicle.id)

  if (cooldownDays > 0 && lastRegularFueling) {
    const nextAllowedDate = addDays(lastRegularFueling.date, cooldownDays)

    if (checkDate < nextAllowedDate) {
      return makeBlockedResult('REFUEL_COOLDOWN_ACTIVE', normalizedPlateNumber, {
        vehicle_id: vehicle.id,
        station_id: stationId,
        date: checkDate,
        last_fueling_record_id: lastRegularFueling.id,
        last_fueling_station_id: lastRegularFueling.station_id,
        last_fueled_at: lastRegularFueling.fueled_at,
        last_fueling_date: lastRegularFueling.date,
        next_allowed_date: nextAllowedDate,
        cooldown_days: cooldownDays,
        days_since_last_fueling:
          (Date.parse(`${checkDate}T00:00:00.000Z`) -
            Date.parse(`${lastRegularFueling.date}T00:00:00.000Z`)) /
          86_400_000,
      })
    }
  }

  const reservation = snapshot.reservations.find(
    (item) => item.vehicle_id === vehicle.id && item.status !== 'CANCELLED',
  )

  if (!reservation) {
    if (manualOverride) {
      return {
        status: 'ALLOWED',
        reason: 'MANUAL_OVERRIDE_ACTIVE',
        normalized_plate_number: normalizedPlateNumber,
        vehicle_id: vehicle.id,
        manual_override_id: manualOverride.id,
        station_id: stationId,
        date: checkDate,
        matched_fuel_type: null,
        is_within_today_limit: true,
        is_callable_now: true,
        call_unavailable_reason: null,
      }
    }

    return makeBlockedResult('NO_ACTIVE_RESERVATION', normalizedPlateNumber, {
      vehicle_id: vehicle.id,
      station_id: stationId,
      date: checkDate,
    })
  }

  if (manualOverride) {
    return {
      status: 'ALLOWED',
      reason: 'MANUAL_OVERRIDE_ACTIVE',
      normalized_plate_number: normalizedPlateNumber,
      vehicle_id: vehicle.id,
      reservation_id: reservation.id,
      station_id: stationId,
      date: checkDate,
      queue_number: reservation.queue_number,
      fuel_type: reservation.fuel_type,
      preferred_fuel_type: reservation.fuel_type,
      fuel_preference_mode: reservation.fuel_preference_mode ?? 'EXACT',
      matched_fuel_type: null,
      is_within_today_limit: true,
      is_callable_now: true,
      call_unavailable_reason: null,
      fuel_category: getFuelQueueCategory(reservation.fuel_type) ?? undefined,
      requested_liters: reservation.requested_liters,
      manual_override_id: manualOverride.id,
    }
  }

  const isActiveSavedAllocation =
    reservation.allocation_status === 'ACTIVE' &&
    reservation.date === checkDate &&
    reservation.station_id === stationId &&
    Boolean(reservation.allocation_id)

  if (
    reservation.allocation_status === 'ACTIVE' &&
    reservation.date === checkDate &&
    reservation.station_id !== stationId &&
    Boolean(reservation.allocation_id)
  ) {
    return makeBlockedResult('RESERVATION_AT_OTHER_STATION', normalizedPlateNumber, {
      vehicle_id: vehicle.id,
      reservation_id: reservation.id,
      allocation_id: reservation.allocation_id,
      queue_entry_id: reservation.queue_entry_id,
      station_id: stationId,
      reservation_station_id: reservation.station_id ?? undefined,
      date: checkDate,
      queue_number: reservation.queue_number,
      fuel_type: reservation.fuel_type,
      preferred_fuel_type: reservation.fuel_type,
      fuel_preference_mode: reservation.fuel_preference_mode ?? 'EXACT',
      matched_fuel_type: reservation.assigned_fuel_type ?? reservation.matched_fuel_type ?? undefined,
      is_within_today_limit: false,
      is_callable_now: false,
      call_unavailable_reason: 'RESERVATION_AT_OTHER_STATION',
    })
  }

  if (!isActiveSavedAllocation) {
    return makeBlockedResult('OUTSIDE_TODAY_LIMIT', normalizedPlateNumber, {
      vehicle_id: vehicle.id,
      reservation_id: reservation.id,
      allocation_id: reservation.allocation_id,
      queue_entry_id: reservation.queue_entry_id,
      station_id: stationId,
      date: checkDate,
      queue_number: reservation.queue_number,
      fuel_type: reservation.fuel_type,
      preferred_fuel_type: reservation.fuel_type,
      fuel_preference_mode: reservation.fuel_preference_mode ?? 'EXACT',
      matched_fuel_type: reservation.assigned_fuel_type ?? reservation.matched_fuel_type ?? null,
      is_within_today_limit: false,
      is_callable_now: false,
      call_unavailable_reason: reservation.allocation_status ?? 'NO_SAVED_ALLOCATION',
    })
  }

  return {
    status: 'ALLOWED',
    reason: manualOverride ? 'MANUAL_OVERRIDE_ACTIVE' : 'ACTIVE_RESERVATION',
    normalized_plate_number: normalizedPlateNumber,
    vehicle_id: vehicle.id,
    reservation_id: reservation.id,
    allocation_id: reservation.allocation_id,
    queue_entry_id: reservation.queue_entry_id,
    station_id: stationId,
    date: checkDate,
    queue_number: reservation.queue_number,
    fuel_type: reservation.fuel_type,
    preferred_fuel_type: reservation.fuel_type,
    fuel_preference_mode: reservation.fuel_preference_mode ?? 'EXACT',
    matched_fuel_type: reservation.assigned_fuel_type ?? reservation.matched_fuel_type ?? null,
    is_within_today_limit: true,
    is_callable_now: true,
    call_unavailable_reason: null,
    fuel_category: getFuelQueueCategory(reservation.assigned_fuel_type ?? reservation.fuel_type) ?? undefined,
    requested_liters: reservation.requested_liters,
    effective_liters: reservation.requested_liters,
    category_position: reservation.station_fuel_position,
    arrival_at: reservation.arrival_at,
  }
}

export async function checkVehicleAccessOffline(
  params: CheckVehicleAccessParams,
): Promise<VehicleAccessResult> {
  const [vehicles, reservations, fuelingRecords, manualOverrides, cooldownDays] =
    await Promise.all([
      offlineDb.local_vehicles.toArray(),
      offlineDb.local_reservations.toArray(),
      offlineDb.local_fueling_records.toArray(),
      offlineDb.local_manual_overrides.toArray(),
      getCachedRefuelCooldownDays(),
    ])

  return evaluateVehicleAccessOffline(params, {
    vehicles,
    reservations,
    dailyLimits: [],
    fuelingRecords,
    manualOverrides,
    cooldownDays,
  })
}
