import { useMutation } from '@tanstack/react-query'

import { signInWithYandex } from '@/shared/api/auth'

export function useYandexLogin() {
  return useMutation({
    mutationFn: async () => {
      const result = await signInWithYandex()

      if (result.error || !result.data) {
        console.error('Yandex OAuth sign-in failed.', result.error)
        throw new Error(result.error ?? 'Не удалось начать вход через Яндекс ID.')
      }

      return result.data
    },
  })
}
