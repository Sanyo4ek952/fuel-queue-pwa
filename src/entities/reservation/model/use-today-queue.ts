import { useQuery } from '@tanstack/react-query'
import { liveQuery } from 'dexie'
import { useEffect, useMemo, useState } from 'react'

import {
  cacheTodayQueueRows,
  listTodayQueueRows,
  toTodayQueueRowFromLocal,
  withCurrentQueuePositions,
  type TodayQueueRow,
} from '@/shared/api/reservation'
import { offlineDb } from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

const activeReservationStatuses = new Set(['RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'])

export const todayQueueQueryKey = () => ['today-queue'] as const

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

  return withCurrentQueuePositions(
    [...onlineRowsWithPendingCallState, ...unsyncedLocalRows].sort(compareQueueRows),
  )
}

export function useTodayQueue() {
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
