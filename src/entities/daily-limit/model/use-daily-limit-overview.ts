import { useQuery } from '@tanstack/react-query'
import { liveQuery } from 'dexie'
import { useEffect, useMemo, useState } from 'react'

import {
  getDailyLimitOverview,
  getDailyLimitOverviewViaApi,
  type DailyLimitCategoryOverview,
  type DailyLimitOverview,
  type DailyLimitStationOverview,
} from '@/shared/api/rpc'
import {
  getFuelQueueCategory,
  type DailyLimitMode,
  type FuelQueueCategory,
  type QueueFuelType,
} from '@/shared/constants'
import { offlineDb, type LocalDailyLimit, type LocalReservation } from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

const activeReservationStatuses = new Set(['RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'])
const unsyncedStatuses = new Set(['PENDING', 'SYNCING', 'FAILED', 'CONFLICT'])

const fuelTypeLabels: Record<QueueFuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
}

export type DailyLimitOverviewSource = 'online' | 'offline'

export type DailyLimitOverviewResult = DailyLimitOverview & {
  source: DailyLimitOverviewSource
  is_estimated: boolean
  unsynced_reservation_count: number
}

export const dailyLimitOverviewQueryKey = (date: string) =>
  ['daily-limit-overview', date] as const

export type DailyLimitOverviewTransport = 'supabase' | 'api'

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function normalizeDailyLimitOverview(overview: DailyLimitOverview): DailyLimitOverview {
  return {
    ...overview,
    category_overviews: overview.category_overviews ?? [],
    station_overviews: (overview.station_overviews ?? []).map((station) => ({
      ...station,
      category_overviews: station.category_overviews ?? [],
    })),
  }
}

function toLocalDailyLimit(overview: DailyLimitOverview): LocalDailyLimit | null {
  const normalizedOverview = normalizeDailyLimitOverview(overview)

  if (!normalizedOverview.exists || !normalizedOverview.id || !normalizedOverview.status) {
    return null
  }

  return {
    id: normalizedOverview.id,
    station_id: normalizedOverview.station_id,
    station_name: normalizedOverview.station_name,
    station_address: normalizedOverview.station_address,
    date: normalizedOverview.date,
    status: normalizedOverview.status,
    category_overviews: normalizedOverview.category_overviews,
    station_overviews: normalizedOverview.station_overviews,
    cached_at: new Date().toISOString(),
    updated_at: normalizedOverview.updated_at ?? undefined,
  }
}

function fromLocalDailyLimit(row: LocalDailyLimit): DailyLimitOverview {
  return {
    exists: true,
    id: row.id,
    date: row.date,
    station_id: row.station_id ?? null,
    station_name: row.station_name ?? null,
    station_address: row.station_address ?? null,
    status: row.status as DailyLimitOverview['status'],
    category_overviews: (row.category_overviews ?? []).map((item) => ({
      fuel_type: item.fuel_type as DailyLimitCategoryOverview['fuel_type'],
      fuel_category: item.fuel_category as FuelQueueCategory,
      label: item.label,
      limit_mode: item.limit_mode as DailyLimitMode,
      vehicle_limit: item.vehicle_limit,
      liters_limit: item.liters_limit,
      queue_count: item.queue_count,
      queued_liters: item.queued_liters,
      covered_vehicle_count: item.covered_vehicle_count,
      covered_liters: item.covered_liters,
      remaining_vehicle_count: item.remaining_vehicle_count,
      remaining_liters: item.remaining_liters,
      projected_queue_number: item.projected_queue_number,
    })),
    station_overviews: (row.station_overviews ?? []).map((station) => ({
      exists: true,
      id: station.id,
      date: station.date,
      station_id: station.station_id,
      station_name: station.station_name,
      station_address: station.station_address,
      status: station.status as DailyLimitOverview['status'],
      category_overviews: (station.category_overviews ?? []).map((item) => ({
        fuel_type: item.fuel_type as DailyLimitCategoryOverview['fuel_type'],
        fuel_category: item.fuel_category as FuelQueueCategory,
        label: item.label,
        limit_mode: item.limit_mode as DailyLimitMode,
        vehicle_limit: item.vehicle_limit,
        liters_limit: item.liters_limit,
        queue_count: item.queue_count,
        queued_liters: item.queued_liters,
        covered_vehicle_count: item.covered_vehicle_count,
        covered_liters: item.covered_liters,
        remaining_vehicle_count: item.remaining_vehicle_count,
        remaining_liters: item.remaining_liters,
        projected_queue_number: item.projected_queue_number,
      })),
      updated_at: station.updated_at,
    })),
    updated_at: row.updated_at ?? row.cached_at ?? null,
  }
}

function makeMissingOverview(date: string): DailyLimitOverview {
  return {
    exists: false,
    id: null,
    date,
    station_id: null,
    station_name: null,
    station_address: null,
    status: null,
    category_overviews: [],
    station_overviews: [],
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

function makeEmptyFuelTypeOverview(fuelType: QueueFuelType): DailyLimitCategoryOverview {
  const fuelCategory = getFuelQueueCategory(fuelType) ?? 'GASOLINE'

  return {
    fuel_type: fuelType,
    fuel_category: fuelCategory,
    label: fuelTypeLabels[fuelType],
    limit_mode: 'vehicle_count',
    vehicle_limit: 0,
    liters_limit: null,
    queue_count: 0,
    queued_liters: 0,
    covered_vehicle_count: 0,
    covered_liters: 0,
    remaining_vehicle_count: 0,
    remaining_liters: null,
    projected_queue_number: null,
  }
}

export function applyUnsyncedReservationEstimate(
  overview: DailyLimitOverview,
  reservations: LocalReservation[],
  source: DailyLimitOverviewSource,
): DailyLimitOverviewResult {
  const normalizedOverview = normalizeDailyLimitOverview(overview)
  const unsyncedReservations = getUnsyncedActiveReservations(reservations)
  const stationOverviews =
    normalizedOverview.station_overviews.length > 0
      ? normalizedOverview.station_overviews.map((station) =>
          applyUnsyncedReservationEstimateToStation(station, unsyncedReservations),
        )
      : []

  if (!normalizedOverview.exists || unsyncedReservations.length === 0) {
    return {
      ...normalizedOverview,
      station_overviews: stationOverviews,
      source,
      is_estimated: source === 'offline',
      unsynced_reservation_count: unsyncedReservations.length,
    }
  }

  const baseOverview =
    stationOverviews.length > 0
      ? {
          ...normalizedOverview,
          category_overviews: applyUnsyncedReservationEstimateToStation(
            {
              exists: normalizedOverview.exists,
              id: normalizedOverview.id,
              date: normalizedOverview.date,
              station_id: null,
              station_name: normalizedOverview.station_name,
              station_address: normalizedOverview.station_address,
              status: normalizedOverview.status,
              category_overviews: normalizedOverview.category_overviews,
              updated_at: normalizedOverview.updated_at,
            },
            unsyncedReservations,
          ).category_overviews,
          station_overviews: stationOverviews,
        }
      : normalizedOverview

  if (stationOverviews.length > 0) {
    return {
      ...baseOverview,
      source,
      is_estimated: true,
      unsynced_reservation_count: unsyncedReservations.length,
    }
  }

  return {
    ...applyUnsyncedReservationEstimateToStation(baseOverview, unsyncedReservations),
    station_overviews: [],
    source,
    is_estimated: true,
    unsynced_reservation_count: unsyncedReservations.length,
  }
}

function applyUnsyncedReservationEstimateToStation(
  overview: DailyLimitStationOverview,
  unsyncedReservations: LocalReservation[],
): DailyLimitStationOverview {
  const stationReservations =
    overview.station_id === null
      ? unsyncedReservations
      : unsyncedReservations.filter(
          (reservation) => reservation.station_id === overview.station_id,
        )

  if (!overview.exists || stationReservations.length === 0) {
    return overview
  }

  const overviewsByFuel = new Map(
    overview.category_overviews.map((item) => [item.fuel_type ?? item.fuel_category, { ...item }]),
  )

  for (const reservation of stationReservations) {
    const fuelType = reservation.fuel_type as QueueFuelType
    const fuelCategory = getFuelQueueCategory(fuelType)

    if (!fuelCategory) {
      continue
    }

    const item =
      overviewsByFuel.get(fuelType) ?? makeEmptyFuelTypeOverview(fuelType)
    const requestedLiters = toNumber(reservation.requested_liters)

    item.queue_count += 1
    item.queued_liters += requestedLiters

    if (item.limit_mode === 'vehicle_count') {
      if (item.covered_vehicle_count < item.vehicle_limit) {
        item.covered_vehicle_count += 1
        item.covered_liters += requestedLiters
        item.projected_queue_number = Math.max(
          item.projected_queue_number ?? 0,
          reservation.queue_number,
        )
      }

      item.remaining_vehicle_count = Math.max(item.vehicle_limit - item.covered_vehicle_count, 0)
    } else {
      const nextLiters = item.covered_liters + requestedLiters

      if (item.liters_limit != null && nextLiters <= item.liters_limit) {
        item.covered_vehicle_count += 1
        item.covered_liters += requestedLiters
        item.projected_queue_number = Math.max(
          item.projected_queue_number ?? 0,
          reservation.queue_number,
        )
      }

      item.remaining_liters =
        item.liters_limit == null ? null : Math.max(item.liters_limit - item.covered_liters, 0)
    }

    overviewsByFuel.set(fuelType, item)
  }

  return {
    ...overview,
    category_overviews: Array.from(overviewsByFuel.values()),
  }
}

async function cacheDailyLimitOverview(overview: DailyLimitOverview) {
  const localDailyLimit = toLocalDailyLimit(overview)

  if (!localDailyLimit) {
    return
  }

  await offlineDb.local_daily_limits.put(localDailyLimit)
}

export function useDailyLimitOverview({
  date,
  transport = 'supabase',
}: {
  date: string
  transport?: DailyLimitOverviewTransport
}) {
  const isOnline = useOnlineStatus()
  const [localOverview, setLocalOverview] = useState<DailyLimitOverview | null>(null)
  const [localReservations, setLocalReservations] = useState<LocalReservation[]>([])
  const [localError, setLocalError] = useState<Error | null>(null)
  const [isLocalReady, setIsLocalReady] = useState(false)
  const enabled = Boolean(date)

  useEffect(() => {
    if (!enabled) {
      setLocalOverview(null)
      setLocalReservations([])
      setIsLocalReady(false)
      return
    }

    const subscription = liveQuery(async () => {
      const [dailyLimit, reservations] = await Promise.all([
        offlineDb.local_daily_limits.where('date').equals(date).first(),
        offlineDb.local_reservations.toArray(),
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
  }, [date, enabled])

  const onlineQuery = useQuery({
    queryKey: [...dailyLimitOverviewQueryKey(date), transport] as const,
    enabled: enabled && isOnline,
    queryFn: async () => {
      const result =
        transport === 'api'
          ? await getDailyLimitOverviewViaApi({ date })
          : await getDailyLimitOverview({ date })

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

    const overview = localOverview ?? makeMissingOverview(date)
    return applyUnsyncedReservationEstimate(overview, localReservations, 'offline')
  }, [date, enabled, isOnline, localOverview, localReservations, onlineQuery.data])

  return {
    data,
    isOnline,
    isLoading: enabled && (isOnline ? onlineQuery.isLoading : !isLocalReady),
    isFetching: onlineQuery.isFetching,
    error: onlineQuery.error ?? localError,
  }
}
