import { useMutation } from '@tanstack/react-query'

import {
  createReservation,
  type CreateReservationParams,
  type CreateReservationResult,
} from '@/shared/api/rpc'

export type { CreateReservationParams, CreateReservationResult }

export function useCreateReservation() {
  return useMutation({
    mutationFn: async (params: CreateReservationParams) => {
      const result = await createReservation(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось создать запись.')
      }

      return result.data
    },
  })
}
