import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createConsumerVehicle,
  listMyVehicles,
  type ConsumerVehicle,
  type CreateConsumerVehicleParams,
} from '@/shared/api/rpc'
import { getConsumerCabinetErrorMessage } from '@/shared/lib/consumer-cabinet-error'

export type { ConsumerVehicle, CreateConsumerVehicleParams }

export const consumerVehiclesQueryKey = ['consumer-vehicles'] as const

const createConsumerVehicleErrorMessages: Record<string, string> = {
  CONSUMER_VEHICLE_LIMIT_EXCEEDED: 'Можно добавить не более 3 автомобилей.',
  VEHICLE_BLOCKED: 'Этот автомобиль заблокирован для записи.',
  INVALID_PLATE_NUMBER: 'Введите корректный госномер.',
  FORBIDDEN: 'Регистрация автомобиля доступна только жителям.',
}

function getCreateConsumerVehicleErrorMessage(error: string) {
  return (
    createConsumerVehicleErrorMessages[error] ??
    getConsumerCabinetErrorMessage(error, 'Не удалось добавить автомобиль.')
  )
}

export function useConsumerVehicles() {
  return useQuery({
    queryKey: consumerVehiclesQueryKey,
    queryFn: listMyVehicles,
    staleTime: 60_000,
  })
}

export function useCreateConsumerVehicle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateConsumerVehicleParams) => {
      const result = await createConsumerVehicle(params)

      if (result.error || !result.data) {
        throw new Error(
          result.error
            ? getCreateConsumerVehicleErrorMessage(result.error)
            : 'Не удалось добавить автомобиль.',
        )
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: consumerVehiclesQueryKey })
    },
  })
}
