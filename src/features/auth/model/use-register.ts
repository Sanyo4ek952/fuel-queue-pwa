import { useMutation } from '@tanstack/react-query'

import {
  signUpWithPassword,
  type SignUpWithPasswordParams,
} from '@/shared/api/auth'

export type { SignUpWithPasswordParams }

export function useRegister() {
  return useMutation({
    mutationFn: async (params: SignUpWithPasswordParams) => {
      const result = await signUpWithPassword(params)

      if (result.error) {
        throw new Error(result.error)
      }

      return result.data
    },
  })
}
