import { useQuery } from '@tanstack/react-query'
import { liveQuery } from 'dexie'
import { useEffect, useMemo, useState } from 'react'

import {
  cacheTodayQueueRows,
  listTodayQueueRows,
  toTodayQueueRowFromLocal,
  type TodayQueueRow,
} from '@/shared/api/reservation'
import { offlineDb } from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

const activeReservationStatuses = new Set(['RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'])

export const todayQueueQueryKey = () => ['today-queue'] as const

function compareQueueRows(left: TodayQueueRow, right: TodayQueueRow) {
  return left.queue_number - right.queue_number || left.id.localeCompare(right.id)
}

function mergeRows(onlineRows: TodayQueueRow[], localRows: TodayQueueRow[]) {
  const byClientMutationId = new Set(
    onlineRows.map((row) => row.client_mutation_id).filter(Boolean),
  )
  const unsyncedLocalRows = localRows.filter(
    (row) => row.sync_status !== 'SYNCED' && !byClientMutationId.has(row.client_mutation_id),
  )

  return [...onlineRows, ...unsyncedLocalRows].sort(compareQueueRows)
}

export function useTodayQueue() {
  const isOnline = useOnlineStatus()
  const [localRows, setLocalRows] = useState<TodayQueueRow[]>([])
  const [localError, setLocalError] = useState<Error | null>(null)
  const [isLocalReady, setIsLocalReady] = useState(false)

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const rows = await offlineDb.local_reservations.toArray()

      return rows
        .filter((row) => activeReservationStatuses.has(row.status))
        .map(toTodayQueueRowFromLocal)
        .sort(compareQueueRows)
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

  const onlineQuery = useQuery({
    queryKey: todayQueueQueryKey(),
    enabled: isOnline,
    queryFn: async () => {
      const rows = await listTodayQueueRows()
      await cacheTodayQueueRows(rows)
      return rows
    },
  })
  const rows = useMemo(
    () => (isOnline && onlineQuery.data ? mergeRows(onlineQuery.data, localRows) : localRows),
    [isOnline, localRows, onlineQuery.data],
  )

  return {
    rows,
    isOnline,
    isLoading: isOnline ? onlineQuery.isLoading : !isLocalReady,
    isFetching: onlineQuery.isFetching,
    error: onlineQuery.error ?? localError,
  }
}

export type { TodayQueueRow }
