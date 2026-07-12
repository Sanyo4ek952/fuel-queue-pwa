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

const createFuelingRecordErrorMessages: Record<string, string> = {
  PREFERENTIAL_ENTRY_NOT_ACTIVE:
    'Льготная запись уже не активна. Обновите данные и проверьте автомобиль ещё раз.',
  ALLOCATION_NOT_ACTIVE:
    'Назначение уже не активно или недоступно для вашей АЗС. Обновите очередь и попробуйте ещё раз.',
  VEHICLE_NOT_FOUND: 'Автомобиль не найден. Проверьте госномер.',
  LITERS_LIMIT_EXCEEDED: 'Указанный объём превышает доступный лимит.',
  STATION_ACCESS_DENIED: 'Нет прав для фиксации заправки на этой АЗС.',
  FORBIDDEN: 'Нет прав для фиксации заправки на этой АЗС.',
}

function isNetworkOrConfigurationError(message: string) {
  return /failed to fetch|load failed|network|supabase is not configured/i.test(message)
}

function isTechnicalMessage(message: string) {
  return /^[A-Z0-9_]+$/.test(message) || !/[А-Яа-яЁё]/.test(message)
}

function getCreateFuelingRecordErrorMessage(error: string | null | undefined) {
  if (!error) {
    return 'Не удалось зафиксировать заправку.'
  }

  if (isNetworkOrConfigurationError(error)) {
    return (
      'Нет связи с сервером или сервис временно недоступен. ' +
      'Проверьте интернет и попробуйте ещё раз.'
    )
  }

  const knownError = Object.entries(createFuelingRecordErrorMessages).find(([code]) =>
    error.includes(code),
  )

  if (knownError) {
    return knownError[1]
  }

  if (isTechnicalMessage(error)) {
    return 'Не удалось зафиксировать заправку. Обновите данные и попробуйте ещё раз.'
  }

  return error
}

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
        throw new Error(getCreateFuelingRecordErrorMessage(result.error))
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
