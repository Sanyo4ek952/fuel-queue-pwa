import { useMutation } from '@tanstack/react-query'

import {
  signUpConsumerWithPassword,
  type SignUpConsumerWithPasswordParams,
} from '@/shared/api/auth'

export type { SignUpConsumerWithPasswordParams }

export function useRegisterConsumer() {
  return useMutation({
    mutationFn: async (params: SignUpConsumerWithPasswordParams) => {
      const result = await signUpConsumerWithPassword(params)

      if (result.error) {
        throw new Error(result.error)
      }

      return result.data
    },
  })
}
