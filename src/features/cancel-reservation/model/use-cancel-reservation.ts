import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  cancelReservation,
  type CancelReservationParams,
  type CancelReservationResult,
} from '@/shared/api/rpc'
import { offlineDb } from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

export type { CancelReservationParams, CancelReservationResult }

const cancelReservationErrorMessages: Record<string, string> = {
  FORBIDDEN: 'Недостаточно прав для удаления записи из очереди.',
  STATION_ACCESS_DENIED: 'Нет доступа к АЗС этой записи.',
  RESERVATION_NOT_FOUND: 'Запись в очереди не найдена.',
  RESERVATION_NOT_ACTIVE: 'Можно удалить только активную запись в очереди.',
  INVALID_CANCEL_REASON: 'Выберите причину удаления.',
  CANCEL_COMMENT_REQUIRED: 'Укажите причину удаления.',
  OFFLINE_UNAVAILABLE: 'Удаление доступно только при подключении к интернету.',
}

function getCancelReservationErrorMessage(error: string) {
  return cancelReservationErrorMessages[error] ?? error
}

export function useCancelReservation() {
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CancelReservationParams) => {
      if (!isOnline) {
        throw new Error(getCancelReservationErrorMessage('OFFLINE_UNAVAILABLE'))
      }

      const result = await cancelReservation(params)

      if (result.error || !result.data) {
        throw new Error(
          result.error
            ? getCancelReservationErrorMessage(result.error)
            : 'Не удалось удалить запись из очереди.',
        )
      }

      return result.data
    },
    onSuccess: async (data) => {
      await offlineDb.local_reservations.update(data.id, {
        status: data.status,
        sync_status: data.sync_status,
        updated_at: data.updated_at,
      })

      void queryClient.invalidateQueries({ queryKey: ['today-queue'] })
      void queryClient.invalidateQueries({ queryKey: ['today-queue-authors'] })
      void queryClient.invalidateQueries({ queryKey: ['cancelled-reservations'] })
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'daily-limit-overview',
      })
    },
  })
}
