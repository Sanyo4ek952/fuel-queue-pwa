import { useMutation } from '@tanstack/react-query'

import { signOut } from '@/shared/api/auth'
import { clearCachedCurrentProfile } from '@/shared/lib/offline-db'

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      const result = await signOut()

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось выйти.')
      }

      await clearCachedCurrentProfile()

      return result.data
    },
  })
}
