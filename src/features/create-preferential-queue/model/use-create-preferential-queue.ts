import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  createPreferentialQueue,
  type CreatePreferentialQueueParams,
  type CreatePreferentialQueueResult,
} from '@/shared/api/rpc'

export type { CreatePreferentialQueueParams, CreatePreferentialQueueResult }

export function useCreatePreferentialQueue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreatePreferentialQueueParams) => {
      const result = await createPreferentialQueue(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось создать льготную очередь.')
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['preferential-queues'] })
    },
  })
}
