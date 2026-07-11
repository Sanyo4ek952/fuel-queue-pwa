import { useMutation, useQueryClient } from '@tanstack/react-query'

import { currentProfileQueryKey } from '@/entities/profile'
import { completeCurrentConsumerProfile } from '@/shared/api/profile'

import type { CompleteConsumerProfileValues } from './schema'

export function useCompleteConsumerProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: CompleteConsumerProfileValues) =>
      completeCurrentConsumerProfile({
        firstName: params.firstName,
        lastName: params.lastName,
        middleName: params.middleName,
        phone: params.phone,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: currentProfileQueryKey })
    },
  })
}
