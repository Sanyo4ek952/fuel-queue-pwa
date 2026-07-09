import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  createFuelingRecord,
  type CreateFuelingRecordParams,
  type CreateFuelingRecordResult,
} from '@/shared/api/rpc'
import {
  createOfflineFuelingRecord,
  offlineDb,
  type OfflineFuelingRecordResult,
} from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

export type { CreateFuelingRecordParams, CreateFuelingRecordResult, OfflineFuelingRecordResult }

export type CreateFuelingRecordMutationParams = CreateFuelingRecordParams & {
  forceOffline?: boolean
}

export type CreateFuelingRecordMutationResult =
  | CreateFuelingRecordResult
  | OfflineFuelingRecordResult

export function useCreateFuelingRecord() {
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      params: CreateFuelingRecordMutationParams,
    ): Promise<CreateFuelingRecordMutationResult> => {
      if (!isOnline || params.forceOffline) {
        return createOfflineFuelingRecord(params)
      }

      const result = await createFuelingRecord(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось зафиксировать заправку.')
      }

      return result.data
    },
    onSuccess: (data) => {
      if (data.preferential_queue_entry_id) {
        void queryClient.invalidateQueries({ queryKey: ['preferential-queues'] })
      }

      if (data.reservation_id) {
        if (isOnline && data.sync_status !== 'PENDING') {
          void offlineDb.local_reservations.update(data.reservation_id, {
            status: 'FUELED',
            updated_at: new Date().toISOString(),
          })
        }
      }

      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'today-queue' ||
          query.queryKey[0] === 'today-queue-authors' ||
          query.queryKey[0] === 'daily-limit-overview',
      })
    },
  })
}
