import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useCurrentProfile } from '@/entities/profile'
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

const createReservationErrorMessages: Record<string, string> = {
  ACTIVE_RESERVATION_ALREADY_EXISTS:
    'Автомобиль уже есть в очереди. Повторная запись запрещена.',
  INVALID_DRIVER_PHONE: 'Введите телефон водителя.',
}

function shouldFallbackToOffline(error: string) {
  return /failed to fetch|network|load failed|supabase is not configured/i.test(error)
}

function getCreateReservationErrorMessage(error: string | null | undefined) {
  if (!error) {
    return 'Не удалось создать запись.'
  }

  const knownError = Object.entries(createReservationErrorMessages).find(([code]) =>
    error.includes(code),
  )

  return knownError?.[1] ?? error
}

export function useCreateReservation() {
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()
  const currentProfileQuery = useCurrentProfile()

  return useMutation({
    mutationFn: async (params: CreateReservationParams): Promise<CreateReservationMutationResult> => {
      if (!isOnline) {
        const profile = currentProfileQuery.data

        return createOfflineReservation({
          ...params,
          createdByProfileId: profile?.id ?? null,
          createdByFullName: profile?.full_name ?? null,
          createdByRole: profile?.role ?? null,
          createdBySignatureName: profile?.signature_name ?? null,
        })
      }

      const result = await createReservation(params)

      if (result.error || !result.data) {
        if (result.error && shouldFallbackToOffline(result.error)) {
          return createOfflineReservation(params)
        }

        if (result.error) {
          throw new Error(getCreateReservationErrorMessage(result.error))
        }

        throw new Error(result.error ?? 'Не удалось создать запись.')
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'today-queue' || query.queryKey[0] === 'daily-limit-overview',
      })
    },
  })
}
