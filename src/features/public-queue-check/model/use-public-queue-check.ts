import { useMutation } from '@tanstack/react-query'

import { checkPublicQueuePosition } from '@/shared/api/rpc'

export function usePublicQueueCheck() {
  return useMutation({
    mutationFn: async (params: Parameters<typeof checkPublicQueuePosition>[0]) => {
      const result = await checkPublicQueuePosition(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось проверить очередь.')
      }

      return result.data
    },
  })
}
