import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getResidentFuelNorm,
  setResidentFuelNorm,
  type ResidentFuelNormSetting,
  type SetResidentFuelNormParams,
} from '@/shared/api/rpc'

export type { ResidentFuelNormSetting, SetResidentFuelNormParams }

export const residentFuelNormQueryKey = ['resident-fuel-norm'] as const

export function useResidentFuelNorm() {
  return useQuery({
    queryKey: residentFuelNormQueryKey,
    queryFn: async () => {
      const result = await getResidentFuelNorm()

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось загрузить норму литров для жителей.')
      }

      return result.data
    },
  })
}

export function useSetResidentFuelNorm() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: SetResidentFuelNormParams) => {
      const result = await setResidentFuelNorm(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось сохранить норму литров для жителей.')
      }

      return result.data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: residentFuelNormQueryKey })
      void queryClient.invalidateQueries({ queryKey: ['my-queue-status'] })
      void queryClient.invalidateQueries({ queryKey: ['today-queue'] })
    },
  })
}
