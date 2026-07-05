import { useMutation } from '@tanstack/react-query'

import {
  signInWithPassword,
  type LoginWithPasswordParams,
} from '@/shared/api/auth'

export type { LoginWithPasswordParams }

export function useLogin() {
  return useMutation({
    mutationFn: async (params: LoginWithPasswordParams) => {
      const result = await signInWithPassword(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось войти.')
      }

      return result.data
    },
  })
}
