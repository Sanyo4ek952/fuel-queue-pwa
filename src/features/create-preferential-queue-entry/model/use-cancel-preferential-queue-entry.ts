import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  cancelPreferentialQueueEntry,
  type CancelPreferentialQueueEntryParams,
} from '@/shared/api/rpc'
import type { PreferentialQueue } from '@/shared/api/preferential-queues'

export function useCancelPreferentialQueueEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CancelPreferentialQueueEntryParams) => {
      const result = await cancelPreferentialQueueEntry(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось отменить льготную заявку.')
      }

      return result.data
    },
    onSuccess: (cancelledEntry) => {
      queryClient.setQueryData<PreferentialQueue[]>(['preferential-queues'], (queues) =>
        queues?.map((queue) =>
          queue.id === cancelledEntry.queue_id
            ? {
                ...queue,
                entries: queue.entries.filter((entry) => entry.id !== cancelledEntry.id),
              }
            : queue,
        ),
      )
      void queryClient.invalidateQueries({ queryKey: ['preferential-queues'] })
    },
  })
}
