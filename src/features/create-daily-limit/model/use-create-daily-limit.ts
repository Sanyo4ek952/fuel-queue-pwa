import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  createDailyLimit,
  type CreateDailyLimitParams,
  type CreateDailyLimitResult,
} from '@/shared/api/rpc'

export type { CreateDailyLimitParams, CreateDailyLimitResult }

export function useCreateDailyLimit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateDailyLimitParams) => {
      const result = await createDailyLimit(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось создать лимит.')
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'daily-limit-overview',
      })
    },
  })
}
