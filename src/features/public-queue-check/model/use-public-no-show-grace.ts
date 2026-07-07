import { useQuery } from '@tanstack/react-query'

import { getPublicNoShowGraceViaApi } from '@/shared/api/public-queue'

export const publicNoShowGraceQueryKey = ['no-show-grace'] as const

export function usePublicNoShowGrace() {
  return useQuery({
    queryKey: publicNoShowGraceQueryKey,
    queryFn: async () => {
      const result = await getPublicNoShowGraceViaApi()

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось загрузить лимит пропусков заправки.')
      }

      return result.data
    },
  })
}
