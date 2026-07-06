import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getRefuelCooldown,
  setRefuelCooldown,
  type RefuelCooldownSetting,
  type SetRefuelCooldownParams,
} from '@/shared/api/rpc'

export type { RefuelCooldownSetting, SetRefuelCooldownParams }

export const refuelCooldownQueryKey = ['refuel-cooldown'] as const

export function useRefuelCooldown() {
  return useQuery({
    queryKey: refuelCooldownQueryKey,
    queryFn: async () => {
      const result = await getRefuelCooldown()

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось загрузить интервал между заправками.')
      }

      return result.data
    },
  })
}

export function useSetRefuelCooldown() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: SetRefuelCooldownParams) => {
      const result = await setRefuelCooldown(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось сохранить интервал между заправками.')
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: refuelCooldownQueryKey })
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'vehicle-access',
      })
    },
  })
}
