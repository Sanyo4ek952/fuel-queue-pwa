import { liveQuery } from 'dexie'
import { useEffect, useMemo, useState } from 'react'

import { offlineDb, type SyncConflict, type SyncOutboxOperation } from '@/shared/lib/offline-db'

export type SyncOutboxSnapshot = {
  operations: SyncOutboxOperation[]
  conflicts: SyncConflict[]
}

export type SyncOutboxSummary = {
  total: number
  pending: number
  syncing: number
  synced: number
  failed: number
  conflict: number
  problemCount: number
}

function createSummary(operations: SyncOutboxOperation[]): SyncOutboxSummary {
  return operations.reduce<SyncOutboxSummary>(
    (summary, operation) => {
      summary.total += 1

      if (operation.status === 'PENDING') {
        summary.pending += 1
      }

      if (operation.status === 'SYNCING') {
        summary.syncing += 1
      }

      if (operation.status === 'SYNCED') {
        summary.synced += 1
      }

      if (operation.status === 'FAILED') {
        summary.failed += 1
        summary.problemCount += 1
      }

      if (operation.status === 'CONFLICT') {
        summary.conflict += 1
        summary.problemCount += 1
      }

      return summary
    },
    {
      total: 0,
      pending: 0,
      syncing: 0,
      synced: 0,
      failed: 0,
      conflict: 0,
      problemCount: 0,
    },
  )
}

export function getSyncOutboxSummary(operations: SyncOutboxOperation[]) {
  return createSummary(operations)
}

export function useSyncOutbox() {
  const [snapshot, setSnapshot] = useState<SyncOutboxSnapshot>({
    operations: [],
    conflicts: [],
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [operations, conflicts] = await Promise.all([
        offlineDb.sync_outbox.toArray(),
        offlineDb.sync_conflicts.toArray(),
      ])

      return {
        operations: operations.sort((left, right) =>
          right.created_at.localeCompare(left.created_at),
        ),
        conflicts: conflicts.sort((left, right) =>
          right.created_at.localeCompare(left.created_at),
        ),
      }
    }).subscribe({
      next: (nextSnapshot) => {
        setSnapshot(nextSnapshot)
        setError(null)
        setIsLoading(false)
      },
      error: (nextError) => {
        setError(nextError instanceof Error ? nextError : new Error('Не удалось загрузить sync.'))
        setIsLoading(false)
      },
    })

    return () => subscription.unsubscribe()
  }, [])

  const summary = useMemo(() => createSummary(snapshot.operations), [snapshot.operations])

  return {
    ...snapshot,
    summary,
    isLoading,
    error,
  }
}
