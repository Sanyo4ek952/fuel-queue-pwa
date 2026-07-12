import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createConsumerVehicle,
  listMyVehicles,
  unlinkMyVehicle,
  type ConsumerVehicle,
  type CreateConsumerVehicleParams,
  type UnlinkMyVehicleParams,
} from '@/shared/api/rpc'
import { getConsumerCabinetErrorMessage } from '@/shared/lib/consumer-cabinet-error'

export type { ConsumerVehicle, CreateConsumerVehicleParams, UnlinkMyVehicleParams }

export const consumerVehiclesQueryKey = ['consumer-vehicles'] as const

const createConsumerVehicleErrorMessages: Record<string, string> = {
  CONSUMER_VEHICLE_LIMIT_EXCEEDED: 'Можно добавить не более 3 автомобилей.',
  VEHICLE_BLOCKED: 'Этот автомобиль заблокирован для записи.',
  VEHICLE_ALREADY_ASSIGNED:
    'Этот госномер уже добавлен другим жителем. Если это ваш номер, обратитесь в администрацию.',
  VEHICLE_IN_ACTIVE_QUEUE:
    'Этот номер уже стоит в очереди. Добавить его можно после заправки или выхода из очереди.',
  INVALID_PLATE_NUMBER: 'Введите корректный госномер.',
  FORBIDDEN: 'Регистрация автомобиля доступна только жителям.',
}

const unlinkConsumerVehicleErrorMessages: Record<string, string> = {
  CONSUMER_VEHICLE_NOT_FOUND: 'Автомобиль не найден в вашем кабинете.',
  VEHICLE_IN_ACTIVE_QUEUE:
    'Номер нельзя отвязать, пока автомобиль стоит в активной очереди. Сначала отмените запись или дождитесь завершения.',
  FORBIDDEN: 'Отвязка автомобиля доступна только владельцу кабинета жителя.',
}

function getCreateConsumerVehicleErrorMessage(error: string) {
  return (
    createConsumerVehicleErrorMessages[error] ??
    getConsumerCabinetErrorMessage(error, 'Не удалось добавить автомобиль.')
  )
}

function getUnlinkConsumerVehicleErrorMessage(error: string) {
  return (
    unlinkConsumerVehicleErrorMessages[error] ??
    getConsumerCabinetErrorMessage(error, 'Не удалось отвязать автомобиль.')
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

export function useUnlinkConsumerVehicle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: UnlinkMyVehicleParams) => {
      const result = await unlinkMyVehicle(params)

      if (result.error || !result.data) {
        throw new Error(
          result.error
            ? getUnlinkConsumerVehicleErrorMessage(result.error)
            : 'Не удалось отвязать автомобиль.',
        )
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: consumerVehiclesQueryKey })
    },
  })
}
