import { useMutation } from '@tanstack/react-query'

import {
  createDailyLimit,
  type CreateDailyLimitParams,
  type CreateDailyLimitResult,
} from '@/shared/api/rpc'

export type { CreateDailyLimitParams, CreateDailyLimitResult }

export function useCreateDailyLimit() {
  return useMutation({
    mutationFn: async (params: CreateDailyLimitParams) => {
      const result = await createDailyLimit(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось создать лимит.')
      }

      return result.data
    },
  })
}
