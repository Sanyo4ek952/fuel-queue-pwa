import {
  type CheckVehicleAccessParams,
  type VehicleAccessReason,
  type VehicleAccessResult,
} from '@/shared/types/vehicle-access'
import {
  getCompatibleFuelTypes,
  getFuelQueueCategory,
  type QueueFuelType,
} from '@/shared/constants'
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

type LimitOverview = NonNullable<LocalDailyLimit['category_overviews']>[number]

function getOverviewKey(overview: LimitOverview) {
  return overview.fuel_type ?? overview.fuel_category
}

function cloneFuelOverviews(dailyLimit: LocalDailyLimit | undefined) {
  return new Map(
    (dailyLimit?.category_overviews ?? []).map((overview) => [
      getOverviewKey(overview),
      { ...overview },
    ]),
  )
}

function canCoverOverview(overview: LimitOverview | undefined, effectiveLiters: number) {
  if (!overview) {
    return false
  }

  if (overview.limit_mode === 'fuel_liters') {
    return overview.liters_limit != null && overview.liters_limit >= effectiveLiters
  }

  return overview.vehicle_limit > 0
}

function consumeOverview(overview: LimitOverview, effectiveLiters: number) {
  if (overview.limit_mode === 'fuel_liters' && overview.liters_limit != null) {
    overview.liters_limit = Math.max(overview.liters_limit - effectiveLiters, 0)
    return
  }

  overview.vehicle_limit = Math.max(overview.vehicle_limit - 1, 0)
}

function pickMatchedFuelType(
  reservation: LocalReservation,
  overviewsByFuel: Map<string, LimitOverview>,
  effectiveLiters: number,
): QueueFuelType | null {
  const compatibleFuelTypes = getCompatibleFuelTypes(
    reservation.fuel_type,
    reservation.fuel_preference_mode ?? 'EXACT',
  )

  for (const fuelType of compatibleFuelTypes) {
    const exactOverview = overviewsByFuel.get(fuelType)

    if (exactOverview && canCoverOverview(exactOverview, effectiveLiters)) {
      consumeOverview(exactOverview, effectiveLiters)
      return fuelType
    }
  }

  const category = getFuelQueueCategory(reservation.fuel_type)
  const categoryOverview = category ? overviewsByFuel.get(category) : undefined

  if (categoryOverview && canCoverOverview(categoryOverview, effectiveLiters)) {
    consumeOverview(categoryOverview, effectiveLiters)
    return compatibleFuelTypes[0] ?? null
  }

  return null
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
      matchedFuelType: null,
      reason: dailyLimit ? 'OUTSIDE_TODAY_LIMIT' : 'NO_GLOBAL_DAILY_LIMIT',
    } as const
  }

  const overviewsByFuel = cloneFuelOverviews(dailyLimit)
  const activeReservations = reservations
    .filter((item) => activeReservationStatuses.has(item.status))
    .sort((left, right) => left.queue_number - right.queue_number || left.id.localeCompare(right.id))

  let coveredVehicleCount = 0
  let coveredLiters = 0

  for (const item of activeReservations) {
    const effectiveLiters = getEffectiveLiters(item)
    const matchedFuelType = pickMatchedFuelType(item, overviewsByFuel, effectiveLiters)
    const isCurrentCovered = Boolean(matchedFuelType)
    const nextVehicleCount = coveredVehicleCount + (isCurrentCovered ? 1 : 0)
    const nextLiters = coveredLiters + (isCurrentCovered ? effectiveLiters : 0)

    if (item.id === reservation.id) {
      return {
        isCovered: isCurrentCovered,
        fuelCategory,
        matchedFuelType,
        effectiveLiters,
        categoryPosition: nextVehicleCount || undefined,
        categoryLiters: nextLiters || undefined,
        reason: 'OUTSIDE_TODAY_LIMIT',
      } as const
    }

    coveredVehicleCount = nextVehicleCount
    coveredLiters = nextLiters
  }

  return {
    isCovered: false,
    fuelCategory,
    matchedFuelType: null,
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
      preferred_fuel_type: reservation.fuel_type,
      fuel_preference_mode: reservation.fuel_preference_mode ?? 'EXACT',
      matched_fuel_type: limitDecision.matchedFuelType,
      is_within_today_limit: false,
      is_callable_now: false,
      call_unavailable_reason:
        limitDecision.reason === 'NO_GLOBAL_DAILY_LIMIT'
          ? 'NO_OPEN_DAILY_LIMIT'
          : 'OUTSIDE_TODAY_LIMIT',
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
    preferred_fuel_type: reservation.fuel_type,
    fuel_preference_mode: reservation.fuel_preference_mode ?? 'EXACT',
    matched_fuel_type: limitDecision.matchedFuelType,
    is_within_today_limit: true,
    is_callable_now: true,
    call_unavailable_reason: null,
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
