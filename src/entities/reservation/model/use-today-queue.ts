import { liveQuery } from 'dexie'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  cacheTodayQueueRows,
  listTodayQueueRows,
  toTodayQueueRowFromLocal,
  type TodayQueueRow,
} from '@/shared/api/reservation'
import { offlineDb } from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

export const todayQueueQueryKey = (stationId: string, date: string) =>
  ['today-queue', stationId, date] as const

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

export function useTodayQueue({ stationId, date }: { stationId: string; date: string }) {
  const isOnline = useOnlineStatus()
  const [localRows, setLocalRows] = useState<TodayQueueRow[]>([])
  const [localError, setLocalError] = useState<Error | null>(null)
  const enabled = Boolean(stationId && date)

  useEffect(() => {
    if (!enabled) {
      setLocalRows([])
      return
    }

    const subscription = liveQuery(async () => {
      const rows = await offlineDb.local_reservations
        .where('[station_id+date]')
        .equals([stationId, date])
        .toArray()

      return rows.map(toTodayQueueRowFromLocal).sort(compareQueueRows)
    }).subscribe({
      next: (rows) => {
        setLocalRows(rows)
        setLocalError(null)
      },
      error: (error) => {
        setLocalError(error instanceof Error ? error : new Error('Не удалось загрузить очередь.'))
      },
    })

    return () => subscription.unsubscribe()
  }, [date, enabled, stationId])

  const onlineQuery = useQuery({
    queryKey: todayQueueQueryKey(stationId, date),
    enabled: enabled && isOnline,
    queryFn: async () => {
      const rows = await listTodayQueueRows({ stationId, date })
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
    isLoading: enabled && (isOnline ? onlineQuery.isLoading : localRows.length === 0 && !localError),
    isFetching: onlineQuery.isFetching,
    error: onlineQuery.error ?? localError,
  }
}

export type { TodayQueueRow }
