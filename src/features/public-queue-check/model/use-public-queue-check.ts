import { useMutation } from '@tanstack/react-query'

import { checkPublicQueuePositionViaApi } from '@/shared/api/public-queue'

export function usePublicQueueCheck() {
  return useMutation({
    mutationFn: async (params: Parameters<typeof checkPublicQueuePositionViaApi>[0]) => {
      const result = await checkPublicQueuePositionViaApi(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось проверить очередь.')
      }

      return result.data
    },
  })
}
