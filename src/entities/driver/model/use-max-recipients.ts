import { useQuery } from '@tanstack/react-query'

import { listMaxRecipients, type MaxRecipient } from '@/shared/api/rpc'
import { useOnlineStatus } from '@/shared/lib/sync'

export const maxRecipientsQueryKey = ['max-recipients'] as const

export function useMaxRecipients() {
  const isOnline = useOnlineStatus()

  return useQuery({
    queryKey: maxRecipientsQueryKey,
    enabled: isOnline,
    queryFn: async () => {
      const result = await listMaxRecipients()

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось загрузить получателей MAX.')
      }

      return result.data
    },
  })
}

export type { MaxRecipient }
