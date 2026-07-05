import { useMutation } from '@tanstack/react-query'

import {
  createManualOverride,
  type CreateManualOverrideParams,
  type CreateManualOverrideResult,
} from '@/shared/api/rpc'
import {
  createOfflineManualOverride,
  type OfflineManualOverrideResult,
} from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

export type {
  CreateManualOverrideParams,
  CreateManualOverrideResult,
  OfflineManualOverrideResult,
}

export type CreateManualOverrideMutationResult =
  | CreateManualOverrideResult
  | OfflineManualOverrideResult

function shouldFallbackToOffline(error: string) {
  return /failed to fetch|network|load failed|supabase is not configured/i.test(error)
}

export function useCreateManualOverride() {
  const isOnline = useOnlineStatus()

  return useMutation({
    mutationFn: async (
      params: CreateManualOverrideParams,
    ): Promise<CreateManualOverrideMutationResult> => {
      if (!isOnline) {
        return createOfflineManualOverride(params)
      }

      const result = await createManualOverride(params)

      if (result.error || !result.data) {
        if (result.error && shouldFallbackToOffline(result.error)) {
          return createOfflineManualOverride(params)
        }

        throw new Error(result.error ?? 'Не удалось создать ручное разрешение.')
      }

      return result.data
    },
  })
}
