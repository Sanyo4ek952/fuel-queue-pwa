import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  cancelMyReservation,
  type CancelMyReservationParams,
  type CancelMyReservationResult,
} from '@/shared/api/rpc'
import { getConsumerCabinetErrorMessage } from '@/shared/lib/consumer-cabinet-error'
import { useOnlineStatus } from '@/shared/lib/sync'

export type { CancelMyReservationParams, CancelMyReservationResult }

const myQueueStatusQueryKey = ['my-queue-status'] as const

const cancelMyReservationErrorMessages: Record<string, string> = {
  RESERVATION_NOT_FOUND: 'Активная запись не найдена.',
  RESERVATION_CANCEL_FORBIDDEN: 'Запись уже нельзя отменить самостоятельно.',
  FORBIDDEN: 'Отмена доступна только владельцу записи.',
  OFFLINE_UNAVAILABLE: 'Отмена доступна только при подключении к интернету.',
}

function getCancelMyReservationErrorMessage(error: string) {
  return (
    cancelMyReservationErrorMessages[error] ??
    getConsumerCabinetErrorMessage(error, 'Не удалось отменить запись.')
  )
}

export function useCancelConsumerReservation() {
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CancelMyReservationParams) => {
      if (!isOnline) {
        throw new Error(getCancelMyReservationErrorMessage('OFFLINE_UNAVAILABLE'))
      }

      const result = await cancelMyReservation(params)

      if (result.error || !result.data) {
        throw new Error(
          result.error
            ? getCancelMyReservationErrorMessage(result.error)
            : 'Не удалось отменить запись.',
        )
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myQueueStatusQueryKey })
    },
  })
}
