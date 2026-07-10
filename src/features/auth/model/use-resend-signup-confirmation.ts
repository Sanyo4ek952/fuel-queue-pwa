import { useMutation } from '@tanstack/react-query'

import {
  resendSignupConfirmationEmail,
  type ResendSignupConfirmationEmailParams,
} from '@/shared/api/auth'

import { AuthMutationError } from './auth-error'

export type { ResendSignupConfirmationEmailParams }

export function useResendSignupConfirmation() {
  return useMutation({
    mutationFn: async (params: ResendSignupConfirmationEmailParams) => {
      const result = await resendSignupConfirmationEmail(params)

      if (result.error) {
        throw new AuthMutationError(result)
      }

      return result.data
    },
  })
}
