import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getDailyFuelingSchedule,
  setDailyFuelingSchedule,
  type DailyFuelingScheduleRow,
  type SetDailyFuelingScheduleParams,
} from '@/shared/api/rpc'
import { getCachedDailyFuelingSchedule } from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

export type { DailyFuelingScheduleRow, SetDailyFuelingScheduleParams }

export const dailyFuelingScheduleQueryKey = (targetDate: string) =>
  ['daily-fueling-schedule', targetDate] as const

export function useDailyFuelingSchedule(targetDate: string) {
  const isOnline = useOnlineStatus()

  return useQuery({
    queryKey: dailyFuelingScheduleQueryKey(targetDate),
    queryFn: async () => {
      if (!isOnline) {
        return getCachedDailyFuelingSchedule(targetDate)
      }

      const result = await getDailyFuelingSchedule(targetDate)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось загрузить расписание розлива.')
      }

      return result.data
    },
  })
}

export function useSetDailyFuelingSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: SetDailyFuelingScheduleParams) => {
      const result = await setDailyFuelingSchedule(params)

      if (result.error || !result.data) {
        throw new Error(result.error ?? 'Не удалось сохранить расписание розлива.')
      }

      return result.data
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: dailyFuelingScheduleQueryKey(variables.targetDate),
      })
      void queryClient.invalidateQueries({ queryKey: ['today-queue'] })
    },
  })
}
