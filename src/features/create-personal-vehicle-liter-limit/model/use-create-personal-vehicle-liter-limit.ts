import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  createPersonalVehicleLiterLimit,
  type CreatePersonalVehicleLiterLimitParams,
  type CreatePersonalVehicleLiterLimitResult,
} from '@/shared/api/rpc'

export type { CreatePersonalVehicleLiterLimitParams, CreatePersonalVehicleLiterLimitResult }

export function useCreatePersonalVehicleLiterLimit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreatePersonalVehicleLiterLimitParams) => {
      const result = await createPersonalVehicleLiterLimit(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось сохранить персональный лимит.')
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
