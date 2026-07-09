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
  type TodayQueueCursor,
  type TodayQueueRow,
} from '@/shared/api/reservation'
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
}

export type TodayQueueAuthorsParams = {
  plateSearch?: string
  callFilter?: QueueCallFilter
  gasolineFuelFilter?: QueueGasolineFuelFilter
}

function compareQueueRows(left: TodayQueueRow, right: TodayQueueRow) {
  return left.ticket_number - right.ticket_number || left.id.localeCompare(right.id)
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

export function useTodayQueue(params: TodayQueueParams = {}) {
  const isOnline = useOnlineStatus()
  const [localRows, setLocalRows] = useState<TodayQueueRow[]>([])
  const [localError, setLocalError] = useState<Error | null>(null)
  const [isLocalReady, setIsLocalReady] = useState(false)

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const rows = (await offlineDb.local_reservations.toArray())
        .filter((row) => activeReservationStatuses.has(row.status))
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

  const onlineQuery = useInfiniteQuery({
    queryKey: todayQueueQueryKey(params),
    enabled: isOnline,
    initialPageParam: null as TodayQueueCursor | null,
    queryFn: async ({ pageParam }) => {
      const page = await listTodayQueueRowsPage({
        pageSize: TODAY_QUEUE_PAGE_SIZE,
        cursor: pageParam,
        plateSearch: params.plateSearch,
        createdByProfileId: params.createdByProfileId,
        callFilter: params.callFilter,
        gasolineFuelFilter: params.gasolineFuelFilter,
      })

      await cacheTodayQueueRows(page.rows)

      return page
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
  const onlineRows = useMemo(
    () => onlineQuery.data?.pages.flatMap((page) => page.rows) ?? [],
    [onlineQuery.data],
  )
  const rows = useMemo(
    () => (isOnline && onlineQuery.data ? mergeRows(onlineRows, localRows) : localRows),
    [isOnline, localRows, onlineQuery.data, onlineRows],
  )

  return {
    rows,
    isOnline,
    isLoading: isOnline ? onlineQuery.isLoading : !isLocalReady,
    isFetching: onlineQuery.isFetching,
    isFetchingNextPage: onlineQuery.isFetchingNextPage,
    hasNextPage: Boolean(onlineQuery.hasNextPage),
    fetchNextPage: onlineQuery.fetchNextPage,
    error: onlineQuery.error ?? localError,
  }
}

export function useTodayQueueAuthors(params: TodayQueueAuthorsParams = {}) {
  return useQuery({
    queryKey: todayQueueAuthorsQueryKey(params),
    queryFn: () => listTodayQueueAuthors(params),
    staleTime: 5 * 60 * 1000,
  })
}

export type { QueueAuthorOption, TodayQueueRow }
