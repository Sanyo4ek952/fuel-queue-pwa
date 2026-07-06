import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getNoShowGrace,
  getRefuelCooldown,
  setNoShowGrace,
  setRefuelCooldown,
  type NoShowGraceSetting,
  type RefuelCooldownSetting,
  type SetNoShowGraceParams,
  type SetRefuelCooldownParams,
} from '@/shared/api/rpc'

export type {
  NoShowGraceSetting,
  RefuelCooldownSetting,
  SetNoShowGraceParams,
  SetRefuelCooldownParams,
}

export const refuelCooldownQueryKey = ['refuel-cooldown'] as const
export const noShowGraceQueryKey = ['no-show-grace'] as const

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

export function useNoShowGrace() {
  return useQuery({
    queryKey: noShowGraceQueryKey,
    queryFn: async () => {
      const result = await getNoShowGrace()

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось загрузить лимит пропусков заправки.')
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

export function useSetNoShowGrace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: SetNoShowGraceParams) => {
      const result = await setNoShowGrace(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось сохранить лимит пропусков заправки.')
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: noShowGraceQueryKey })
      void queryClient.invalidateQueries({ queryKey: ['today-queue'] })
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'vehicle-access',
      })
    },
  })
}
