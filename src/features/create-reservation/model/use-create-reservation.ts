import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  createReservation,
  type CreateReservationParams,
  type CreateReservationResult,
} from '@/shared/api/rpc'
import {
  createOfflineReservation,
  type OfflineReservationResult,
} from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

export type { CreateReservationParams, CreateReservationResult, OfflineReservationResult }

export type CreateReservationMutationResult = CreateReservationResult | OfflineReservationResult

function shouldFallbackToOffline(error: string) {
  return /failed to fetch|network|load failed|supabase is not configured/i.test(error)
}

export function useCreateReservation() {
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateReservationParams): Promise<CreateReservationMutationResult> => {
      if (!isOnline) {
        return createOfflineReservation(params)
      }

      const result = await createReservation(params)

      if (result.error || !result.data) {
        if (result.error && shouldFallbackToOffline(result.error)) {
          return createOfflineReservation(params)
        }

        throw new Error(result.error ?? 'Не удалось создать запись.')
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'today-queue',
      })
    },
  })
}
