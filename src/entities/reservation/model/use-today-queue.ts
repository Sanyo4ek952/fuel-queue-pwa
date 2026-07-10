import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { liveQuery } from 'dexie'
import { useEffect, useMemo, useState } from 'react'

import {
  cacheTodayQueueRows,
  listTodayQueueAuthors,
  listTodayQueueRowsPage,
  toTodayQueueRowFromLocal,
  withCurrentQueuePositions,
  type QueueAuthorOption,
  type QueueCallFilter,
  type QueueGasolineFuelFilter,
  type TodayQueueSummary,
  type TodayQueueCursor,
  type TodayQueueRow,
} from '@/shared/api/reservation'
import {
  getFuelQueueCategory,
  type FuelQueueCategory,
} from '@/shared/constants'
import { offlineDb } from '@/shared/lib/offline-db'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
import { useOnlineStatus } from '@/shared/lib/sync'

const activeReservationStatuses = new Set(['RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'])
const TODAY_QUEUE_PAGE_SIZE = 25

export const todayQueueQueryKey = (params: TodayQueueParams = {}) =>
  [
    'today-queue',
    normalizePlateNumber(params.plateSearch ?? ''),
    params.createdByProfileId ?? 'all',
    params.callFilter ?? 'all',
    params.gasolineFuelFilter ?? 'all',
    params.fuelCategoryFilter ?? 'all',
  ] as const

export const todayQueueAuthorsQueryKey = (params: TodayQueueAuthorsParams = {}) =>
  [
    'today-queue-authors',
    normalizePlateNumber(params.plateSearch ?? ''),
    params.callFilter ?? 'all',
    params.gasolineFuelFilter ?? 'all',
  ] as const

export type TodayQueueParams = {
  plateSearch?: string
  createdByProfileId?: string | null
  callFilter?: QueueCallFilter
  gasolineFuelFilter?: QueueGasolineFuelFilter
  fuelCategoryFilter?: FuelQueueCategory | null
}

export type TodayQueueAuthorsParams = {
  plateSearch?: string
  callFilter?: QueueCallFilter
  gasolineFuelFilter?: QueueGasolineFuelFilter
}

function compareQueueRows(left: TodayQueueRow, right: TodayQueueRow) {
  return left.ticket_number - right.ticket_number || left.id.localeCompare(right.id)
}

export function isActiveLocalQueueRow(row: { status: string }) {
  return activeReservationStatuses.has(row.status)
}

function mergeRows(onlineRows: TodayQueueRow[], localRows: TodayQueueRow[]) {
  const byClientMutationId = new Set(
    onlineRows.map((row) => row.client_mutation_id).filter(Boolean),
  )
  const localRowsById = new Map(localRows.map((row) => [row.id, row]))
  const onlineRowsWithPendingCallState = onlineRows.map((row) => {
    const localRow = localRowsById.get(row.id)

    if (
      !localRow?.latest_call_client_mutation_id ||
      localRow.latest_call_sync_status === 'SYNCED'
    ) {
      return row
    }

    return {
      ...row,
      latest_call_status: localRow.latest_call_status,
      latest_called_by_profile_id: localRow.latest_called_by_profile_id,
      latest_called_by_full_name: localRow.latest_called_by_full_name,
      latest_called_by_role: localRow.latest_called_by_role,
      latest_called_by_signature_name: localRow.latest_called_by_signature_name,
      latest_called_at: localRow.latest_called_at,
      latest_call_comment: localRow.latest_call_comment,
      latest_call_client_mutation_id: localRow.latest_call_client_mutation_id,
      latest_call_sync_status: localRow.latest_call_sync_status,
    }
  })
  const unsyncedLocalRows = localRows.filter(
    (row) => row.sync_status !== 'SYNCED' && !byClientMutationId.has(row.client_mutation_id),
  )

  return [...onlineRowsWithPendingCallState, ...unsyncedLocalRows].sort(compareQueueRows)
}

function buildLocalSummary(rows: TodayQueueRow[]): TodayQueueSummary {
  return {
    total_count: rows.length,
    callable_count: rows.filter(
      (row) => Boolean(row.is_callable_now ?? row.is_within_today_limit) && row.latest_call_status !== 'CONTACTED',
    ).length,
    contacted_count: rows.filter((row) => row.latest_call_status === 'CONTACTED').length,
    no_answer_count: rows.filter((row) => row.latest_call_status === 'NO_ANSWER').length,
    category_counts: {
      GASOLINE: rows.filter((row) => getFuelQueueCategory(row.fuel_type) === 'GASOLINE').length,
      DIESEL: rows.filter((row) => getFuelQueueCategory(row.fuel_type) === 'DIESEL').length,
      GAS: rows.filter((row) => getFuelQueueCategory(row.fuel_type) === 'GAS').length,
    },
    callable_category_counts: {
      GASOLINE: rows.filter(
        (row) =>
          Boolean(row.is_callable_now ?? row.is_within_today_limit) &&
          getFuelQueueCategory(row.fuel_type) === 'GASOLINE',
      ).length,
      DIESEL: rows.filter(
        (row) =>
          Boolean(row.is_callable_now ?? row.is_within_today_limit) &&
          getFuelQueueCategory(row.fuel_type) === 'DIESEL',
      ).length,
      GAS: rows.filter(
        (row) =>
          Boolean(row.is_callable_now ?? row.is_within_today_limit) &&
          getFuelQueueCategory(row.fuel_type) === 'GAS',
      ).length,
    },
  }
}

function useTodayQueueCategory(params: TodayQueueParams, fuelCategory: FuelQueueCategory, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: todayQueueQueryKey({
      ...params,
      fuelCategoryFilter: fuelCategory,
    }),
    enabled,
    initialPageParam: null as TodayQueueCursor | null,
    queryFn: async ({ pageParam }) => {
      const page = await listTodayQueueRowsPage({
        pageSize: TODAY_QUEUE_PAGE_SIZE,
        cursor: pageParam,
        plateSearch: params.plateSearch,
        createdByProfileId: params.createdByProfileId,
        callFilter: params.callFilter,
        gasolineFuelFilter: params.gasolineFuelFilter,
        fuelCategoryFilter: fuelCategory,
      })

      await cacheTodayQueueRows(page.rows)

      return page
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
}

export function useTodayQueue(params: TodayQueueParams = {}) {
  const isOnline = useOnlineStatus()
  const [localRows, setLocalRows] = useState<TodayQueueRow[]>([])
  const [localError, setLocalError] = useState<Error | null>(null)
  const [isLocalReady, setIsLocalReady] = useState(false)

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const rows = (await offlineDb.local_reservations.toArray())
        .filter(isActiveLocalQueueRow)
        .map(toTodayQueueRowFromLocal)
        .sort(compareQueueRows)

      return withCurrentQueuePositions(rows)
    }).subscribe({
      next: (rows) => {
        setLocalRows(rows)
        setLocalError(null)
        setIsLocalReady(true)
      },
      error: (error) => {
        setLocalError(error instanceof Error ? error : new Error('Не удалось загрузить очередь.'))
        setIsLocalReady(true)
      },
    })

    return () => subscription.unsubscribe()
  }, [])

  const gasolineQuery = useTodayQueueCategory(params, 'GASOLINE', isOnline)
  const dieselQuery = useTodayQueueCategory(params, 'DIESEL', isOnline)
  const gasQuery = useTodayQueueCategory(params, 'GAS', isOnline)
  const onlineRows = useMemo(
    () => [
      ...(gasolineQuery.data?.pages.flatMap((page) => page.rows) ?? []),
      ...(dieselQuery.data?.pages.flatMap((page) => page.rows) ?? []),
      ...(gasQuery.data?.pages.flatMap((page) => page.rows) ?? []),
    ],
    [dieselQuery.data, gasQuery.data, gasolineQuery.data],
  )
  const rows = useMemo(
    () => (isOnline && (gasolineQuery.data || dieselQuery.data || gasQuery.data) ? mergeRows(onlineRows, localRows) : localRows),
    [dieselQuery.data, gasQuery.data, gasolineQuery.data, isOnline, localRows, onlineRows],
  )
  const summary = useMemo(
    () =>
      isOnline && (gasolineQuery.data || dieselQuery.data || gasQuery.data)
        ? (
            gasolineQuery.data?.pages[0]?.summary ??
            dieselQuery.data?.pages[0]?.summary ??
            gasQuery.data?.pages[0]?.summary
          )
        : buildLocalSummary(localRows),
    [dieselQuery.data, gasQuery.data, gasolineQuery.data, isOnline, localRows],
  )
  const categoryPagination = {
    GASOLINE: {
      hasNextPage: Boolean(gasolineQuery.hasNextPage),
      isFetchingNextPage: gasolineQuery.isFetchingNextPage,
      fetchNextPage: gasolineQuery.fetchNextPage,
    },
    DIESEL: {
      hasNextPage: Boolean(dieselQuery.hasNextPage),
      isFetchingNextPage: dieselQuery.isFetchingNextPage,
      fetchNextPage: dieselQuery.fetchNextPage,
    },
    GAS: {
      hasNextPage: Boolean(gasQuery.hasNextPage),
      isFetchingNextPage: gasQuery.isFetchingNextPage,
      fetchNextPage: gasQuery.fetchNextPage,
    },
  } satisfies Record<FuelQueueCategory, {
    hasNextPage: boolean
    isFetchingNextPage: boolean
    fetchNextPage: typeof gasolineQuery.fetchNextPage
  }>

  return {
    rows,
    summary,
    isOnline,
    isLoading: isOnline
      ? gasolineQuery.isLoading || dieselQuery.isLoading || gasQuery.isLoading
      : !isLocalReady,
    isFetching: gasolineQuery.isFetching || dieselQuery.isFetching || gasQuery.isFetching,
    isFetchingNextPage:
      gasolineQuery.isFetchingNextPage ||
      dieselQuery.isFetchingNextPage ||
      gasQuery.isFetchingNextPage,
    hasNextPage:
      Boolean(gasolineQuery.hasNextPage) ||
      Boolean(dieselQuery.hasNextPage) ||
      Boolean(gasQuery.hasNextPage),
    fetchNextPage: gasolineQuery.fetchNextPage,
    categoryPagination,
    error: gasolineQuery.error ?? dieselQuery.error ?? gasQuery.error ?? localError,
  }
}

export function useTodayQueueAuthors(params: TodayQueueAuthorsParams = {}) {
  return useQuery({
    queryKey: todayQueueAuthorsQueryKey(params),
    queryFn: () => listTodayQueueAuthors(params),
    staleTime: 5 * 60 * 1000,
  })
}

export type { QueueAuthorOption, TodayQueueRow, TodayQueueSummary }
