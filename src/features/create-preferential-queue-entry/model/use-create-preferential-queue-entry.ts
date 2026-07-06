import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  createPreferentialQueueEntry,
  type CreatePreferentialQueueEntryParams,
  type CreatePreferentialQueueEntryResult,
} from '@/shared/api/rpc'

export type { CreatePreferentialQueueEntryParams, CreatePreferentialQueueEntryResult }

export function useCreatePreferentialQueueEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreatePreferentialQueueEntryParams) => {
      const result = await createPreferentialQueueEntry(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось добавить машину в льготную очередь.')
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['preferential-queues'] })
    },
  })
}
