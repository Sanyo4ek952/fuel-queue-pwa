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

const activeReservationStatuses = new Set(['RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'])

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

function getEffectiveLiters(reservation: LocalReservation) {
  return reservation.requested_liters || 20
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

function isReservationCoveredByDailyLimit(
  reservation: LocalReservation,
  dailyLimit: LocalDailyLimit | undefined,
  reservations: LocalReservation[],
) {
  const fuelCategory = getFuelQueueCategory(reservation.fuel_type)

  if (!fuelCategory || !dailyLimit) {
    return {
      isCovered: false,
      fuelCategory,
      reason: dailyLimit ? 'OUTSIDE_TODAY_LIMIT' : 'NO_GLOBAL_DAILY_LIMIT',
    } as const
  }

  const categoryOverview = dailyLimit.category_overviews?.find(
    (item) => item.fuel_category === fuelCategory,
  )

  if (!categoryOverview) {
    return {
      isCovered: false,
      fuelCategory,
      reason: 'OUTSIDE_TODAY_LIMIT',
    } as const
  }

  const categoryReservations = reservations
    .filter(
      (item) =>
        activeReservationStatuses.has(item.status) &&
        getFuelQueueCategory(item.fuel_type) === fuelCategory,
    )
    .sort((left, right) => left.queue_number - right.queue_number || left.id.localeCompare(right.id))

  let coveredVehicleCount = 0
  let coveredLiters = 0

  for (const item of categoryReservations) {
    const effectiveLiters = getEffectiveLiters(item)
    const nextVehicleCount = coveredVehicleCount + 1
    const nextLiters = coveredLiters + effectiveLiters
    const isCurrentCovered =
      categoryOverview.limit_mode === 'vehicle_count'
        ? nextVehicleCount <= categoryOverview.vehicle_limit
        : categoryOverview.liters_limit != null && nextLiters <= categoryOverview.liters_limit

    if (item.id === reservation.id) {
      return {
        isCovered: isCurrentCovered,
        fuelCategory,
        effectiveLiters,
        categoryPosition: nextVehicleCount,
        categoryLiters: nextLiters,
        reason: 'OUTSIDE_TODAY_LIMIT',
      } as const
    }

    if (!isCurrentCovered) {
      break
    }

    coveredVehicleCount = nextVehicleCount
    coveredLiters = nextLiters
  }

  return {
    isCovered: false,
    fuelCategory,
    reason: 'OUTSIDE_TODAY_LIMIT',
  } as const
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
    (item) =>
      item.vehicle_id === vehicle.id &&
      activeReservationStatuses.has(item.status),
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
      fuel_category: getFuelQueueCategory(reservation.fuel_type) ?? undefined,
      requested_liters: reservation.requested_liters,
      manual_override_id: manualOverride.id,
    }
  }

  const dailyLimit = snapshot.dailyLimits.find((item) => item.date === checkDate)
  const limitDecision = isReservationCoveredByDailyLimit(
    reservation,
    dailyLimit,
    snapshot.reservations,
  )

  if (!limitDecision.isCovered) {
    return makeBlockedResult(limitDecision.reason, normalizedPlateNumber, {
      vehicle_id: vehicle.id,
      reservation_id: reservation.id,
      station_id: stationId,
      date: checkDate,
      queue_number: reservation.queue_number,
      fuel_type: reservation.fuel_type,
      fuel_category: limitDecision.fuelCategory ?? undefined,
      effective_liters: limitDecision.effectiveLiters,
      category_position: limitDecision.categoryPosition,
      category_liters: limitDecision.categoryLiters,
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
    fuel_category: limitDecision.fuelCategory ?? undefined,
    requested_liters: reservation.requested_liters,
    effective_liters: limitDecision.effectiveLiters,
    category_position: limitDecision.categoryPosition,
    category_liters: limitDecision.categoryLiters,
  }
}

export async function checkVehicleAccessOffline(
  params: CheckVehicleAccessParams,
): Promise<VehicleAccessResult> {
  const [vehicles, reservations, dailyLimits, fuelingRecords, manualOverrides, cooldownDays] =
    await Promise.all([
      offlineDb.local_vehicles.toArray(),
      offlineDb.local_reservations.toArray(),
      offlineDb.local_daily_limits.toArray(),
      offlineDb.local_fueling_records.toArray(),
      offlineDb.local_manual_overrides.toArray(),
      getCachedRefuelCooldownDays(),
    ])

  return evaluateVehicleAccessOffline(params, {
    vehicles,
    reservations,
    dailyLimits,
    fuelingRecords,
    manualOverrides,
    cooldownDays,
  })
}
