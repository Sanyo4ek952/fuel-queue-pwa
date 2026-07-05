import { useMutation } from '@tanstack/react-query'

import {
  createFuelingRecord,
  type CreateFuelingRecordParams,
  type CreateFuelingRecordResult,
} from '@/shared/api/rpc'
import {
  createOfflineFuelingRecord,
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
  })
}
