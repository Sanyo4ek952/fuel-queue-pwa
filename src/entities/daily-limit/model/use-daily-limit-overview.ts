import { useQuery } from '@tanstack/react-query'
import { liveQuery } from 'dexie'
import { useEffect, useMemo, useState } from 'react'

import {
  getDailyLimitOverview,
  type DailyLimitFuelTypeOverview,
  type DailyLimitOverview,
} from '@/shared/api/rpc'
import { FUEL_TYPES, type FuelType } from '@/shared/constants'
import { offlineDb, type LocalDailyLimit, type LocalReservation } from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

const activeReservationStatuses = new Set(['RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'])
const unsyncedStatuses = new Set(['PENDING', 'SYNCING', 'FAILED', 'CONFLICT'])

export type DailyLimitOverviewSource = 'online' | 'offline'

export type DailyLimitOverviewResult = DailyLimitOverview & {
  source: DailyLimitOverviewSource
  is_estimated: boolean
  unsynced_reservation_count: number
}

export const dailyLimitOverviewQueryKey = (stationId: string, date: string) =>
  ['daily-limit-overview', stationId, date] as const

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function toLocalDailyLimit(overview: DailyLimitOverview): LocalDailyLimit | null {
  if (!overview.exists || !overview.id || !overview.status || overview.max_liters_per_vehicle == null) {
    return null
  }

  return {
    id: overview.id,
    station_id: overview.station_id,
    date: overview.date,
    status: overview.status,
    total_vehicle_limit: overview.total_vehicle_limit,
    max_liters_per_vehicle: overview.max_liters_per_vehicle,
    occupied_vehicle_count: overview.occupied_vehicle_count,
    remaining_vehicle_count: overview.remaining_vehicle_count,
    fuel_type_overviews: overview.fuel_type_overviews,
    cached_at: new Date().toISOString(),
    updated_at: overview.updated_at ?? undefined,
  }
}

function fromLocalDailyLimit(row: LocalDailyLimit): DailyLimitOverview {
  return {
    exists: true,
    id: row.id,
    date: row.date,
    station_id: row.station_id,
    status: row.status as DailyLimitOverview['status'],
    total_vehicle_limit: row.total_vehicle_limit ?? null,
    max_liters_per_vehicle: row.max_liters_per_vehicle,
    occupied_vehicle_count: row.occupied_vehicle_count ?? 0,
    remaining_vehicle_count: row.remaining_vehicle_count ?? null,
    fuel_type_overviews: (row.fuel_type_overviews ?? []).map((item) => ({
      fuel_type: item.fuel_type as FuelType,
      vehicle_limit: item.vehicle_limit,
      occupied_vehicle_count: item.occupied_vehicle_count,
      remaining_vehicle_count: item.remaining_vehicle_count,
      liters_limit: item.liters_limit,
      reserved_liters: item.reserved_liters,
      remaining_liters: item.remaining_liters,
    })),
    updated_at: row.updated_at ?? row.cached_at ?? null,
  }
}

function makeMissingOverview(stationId: string, date: string): DailyLimitOverview {
  return {
    exists: false,
    id: null,
    date,
    station_id: stationId,
    status: null,
    total_vehicle_limit: null,
    max_liters_per_vehicle: null,
    occupied_vehicle_count: 0,
    remaining_vehicle_count: null,
    fuel_type_overviews: [],
    updated_at: null,
  }
}

function getUnsyncedActiveReservations(rows: LocalReservation[]) {
  return rows.filter(
    (row) =>
      activeReservationStatuses.has(row.status) &&
      row.sync_status &&
      unsyncedStatuses.has(row.sync_status),
  )
}

function makeEmptyFuelTypeOverview(fuelType: FuelType): DailyLimitFuelTypeOverview {
  return {
    fuel_type: fuelType,
    vehicle_limit: 0,
    occupied_vehicle_count: 0,
    remaining_vehicle_count: 0,
    liters_limit: null,
    reserved_liters: 0,
    remaining_liters: null,
  }
}

export function applyUnsyncedReservationEstimate(
  overview: DailyLimitOverview,
  reservations: LocalReservation[],
  source: DailyLimitOverviewSource,
): DailyLimitOverviewResult {
  const unsyncedReservations = getUnsyncedActiveReservations(reservations)

  if (!overview.exists || unsyncedReservations.length === 0) {
    return {
      ...overview,
      source,
      is_estimated: source === 'offline',
      unsynced_reservation_count: unsyncedReservations.length,
    }
  }

  const fuelTypeOverviewsByType = new Map(
    overview.fuel_type_overviews.map((item) => [item.fuel_type, { ...item }]),
  )

  for (const reservation of unsyncedReservations) {
    const fuelType = reservation.fuel_type as FuelType
    const item = fuelTypeOverviewsByType.get(fuelType) ?? makeEmptyFuelTypeOverview(fuelType)
    const requestedLiters = toNumber(reservation.requested_liters)

    item.occupied_vehicle_count += 1
    item.remaining_vehicle_count = Math.max(item.vehicle_limit - item.occupied_vehicle_count, 0)
    item.reserved_liters += requestedLiters
    item.remaining_liters =
      item.liters_limit == null ? null : Math.max(item.liters_limit - item.reserved_liters, 0)
    fuelTypeOverviewsByType.set(fuelType, item)
  }

  const occupiedVehicleCount = overview.occupied_vehicle_count + unsyncedReservations.length

  return {
    ...overview,
    occupied_vehicle_count: occupiedVehicleCount,
    remaining_vehicle_count:
      overview.total_vehicle_limit == null
        ? null
        : Math.max(overview.total_vehicle_limit - occupiedVehicleCount, 0),
    fuel_type_overviews: FUEL_TYPES.map(
      (fuelType) => fuelTypeOverviewsByType.get(fuelType) ?? makeEmptyFuelTypeOverview(fuelType),
    ),
    source,
    is_estimated: true,
    unsynced_reservation_count: unsyncedReservations.length,
  }
}

async function cacheDailyLimitOverview(overview: DailyLimitOverview) {
  const localDailyLimit = toLocalDailyLimit(overview)

  if (!localDailyLimit) {
    return
  }

  await offlineDb.local_daily_limits.put(localDailyLimit)
}

export function useDailyLimitOverview({ stationId, date }: { stationId: string; date: string }) {
  const isOnline = useOnlineStatus()
  const [localOverview, setLocalOverview] = useState<DailyLimitOverview | null>(null)
  const [localReservations, setLocalReservations] = useState<LocalReservation[]>([])
  const [localError, setLocalError] = useState<Error | null>(null)
  const [isLocalReady, setIsLocalReady] = useState(false)
  const enabled = Boolean(stationId && date)

  useEffect(() => {
    if (!enabled) {
      setLocalOverview(null)
      setLocalReservations([])
      setIsLocalReady(false)
      return
    }

    const subscription = liveQuery(async () => {
      const [dailyLimit, reservations] = await Promise.all([
        offlineDb.local_daily_limits.where('[station_id+date]').equals([stationId, date]).first(),
        offlineDb.local_reservations.where('[station_id+date]').equals([stationId, date]).toArray(),
      ])

      return {
        overview: dailyLimit ? fromLocalDailyLimit(dailyLimit) : null,
        reservations,
      }
    }).subscribe({
      next: ({ overview, reservations }) => {
        setLocalOverview(overview)
        setLocalReservations(reservations)
        setIsLocalReady(true)
        setLocalError(null)
      },
      error: (error) => {
        setIsLocalReady(true)
        setLocalError(
          error instanceof Error
            ? error
            : new Error('Не удалось загрузить локальный снимок лимита.'),
        )
      },
    })

    return () => subscription.unsubscribe()
  }, [date, enabled, stationId])

  const onlineQuery = useQuery({
    queryKey: dailyLimitOverviewQueryKey(stationId, date),
    enabled: enabled && isOnline,
    queryFn: async () => {
      const result = await getDailyLimitOverview({ stationId, date })

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось загрузить обзор лимита.')
      }

      await cacheDailyLimitOverview(result.data)
      return result.data
    },
  })

  const data = useMemo(() => {
    if (!enabled) {
      return null
    }

    if (isOnline && onlineQuery.data) {
      return applyUnsyncedReservationEstimate(onlineQuery.data, localReservations, 'online')
    }

    const overview = localOverview ?? makeMissingOverview(stationId, date)
    return applyUnsyncedReservationEstimate(overview, localReservations, 'offline')
  }, [date, enabled, isOnline, localOverview, localReservations, onlineQuery.data, stationId])

  return {
    data,
    isOnline,
    isLoading: enabled && (isOnline ? onlineQuery.isLoading : !isLocalReady),
    isFetching: onlineQuery.isFetching,
    error: onlineQuery.error ?? localError,
  }
}
