import { useMutation } from '@tanstack/react-query'

import { signUpWithPassword, type SignUpWithPasswordParams } from '@/shared/api/auth'

import { AuthMutationError } from './auth-error'

export type { SignUpWithPasswordParams }

export function useRegister() {
  return useMutation({
    mutationFn: async (params: SignUpWithPasswordParams) => {
      const result = await signUpWithPassword(params)

      if (result.error) {
        throw new AuthMutationError(result)
      }

      return result.data
    },
  })
}
