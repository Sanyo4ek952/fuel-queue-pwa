import { useQuery } from '@tanstack/react-query'

import { listMaxMessageTemplates, type MaxMessageTemplate } from '@/shared/api/rpc'
import { useOnlineStatus } from '@/shared/lib/sync'

export const maxMessageTemplatesQueryKey = ['max-message-templates'] as const

export function useMaxMessageTemplates() {
  const isOnline = useOnlineStatus()

  return useQuery({
    queryKey: maxMessageTemplatesQueryKey,
    enabled: isOnline,
    queryFn: async () => {
      const result = await listMaxMessageTemplates()

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось загрузить шаблоны MAX.')
      }

      return result.data
    },
  })
}

export type { MaxMessageTemplate }
