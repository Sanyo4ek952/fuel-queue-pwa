import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createConsumerReservation,
  getMyQueueStatus,
  type ConsumerReservation,
  type CreateConsumerReservationParams,
} from '@/shared/api/rpc'
import { useOnlineStatus } from '@/shared/lib/sync'

export type { ConsumerReservation, CreateConsumerReservationParams }

export const myQueueStatusQueryKey = ['my-queue-status'] as const

const createConsumerReservationErrorMessages: Record<string, string> = {
  ACTIVE_RESERVATION_ALREADY_EXISTS: 'Этот автомобиль уже есть в очереди.',
  CONSUMER_ACTIVE_RESERVATION_ALREADY_EXISTS: 'У вас уже есть активная запись в очереди.',
  VEHICLE_NOT_OWNED: 'Выберите один из своих автомобилей.',
  VEHICLE_BLOCKED: 'Этот автомобиль заблокирован для записи.',
  REFUEL_COOLDOWN_ACTIVE: 'Для этого автомобиля еще действует ограничение после заправки.',
  INVALID_DRIVER_FULL_NAME: 'Введите ФИО водителя.',
  INVALID_DRIVER_PHONE: 'Введите телефон водителя.',
  INVALID_FUEL_TYPE: 'Выберите вид топлива.',
  INVALID_FUEL_PREFERENCE_MODE: 'Выберите корректное предпочтение по топливу.',
  INVALID_REQUESTED_LITERS: 'Укажите литры больше нуля.',
  FORBIDDEN: 'Запись доступна только жителям.',
  OFFLINE_UNAVAILABLE: 'Запись доступна только при подключении к интернету.',
}

function getCreateConsumerReservationErrorMessage(error: string) {
  return createConsumerReservationErrorMessages[error] ?? error
}

export function useMyQueueStatus() {
  return useQuery({
    queryKey: myQueueStatusQueryKey,
    queryFn: getMyQueueStatus,
    staleTime: 30_000,
  })
}

export function useCreateConsumerReservation() {
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateConsumerReservationParams) => {
      if (!isOnline) {
        throw new Error(getCreateConsumerReservationErrorMessage('OFFLINE_UNAVAILABLE'))
      }

      const result = await createConsumerReservation(params)

      if (result.error || !result.data) {
        throw new Error(
          result.error
            ? getCreateConsumerReservationErrorMessage(result.error)
            : 'Не удалось создать запись.',
        )
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myQueueStatusQueryKey })
    },
  })
}
