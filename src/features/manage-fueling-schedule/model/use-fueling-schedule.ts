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

export const dailyFuelingScheduleQueryKey = (targetDate: string, stationId?: string | null) =>
  ['daily-fueling-schedule', targetDate, stationId ?? 'all'] as const

export function useDailyFuelingSchedule(targetDate: string, stationId?: string | null) {
  const isOnline = useOnlineStatus()

  return useQuery({
    queryKey: dailyFuelingScheduleQueryKey(targetDate, stationId),
    queryFn: async () => {
      if (!isOnline) {
        return getCachedDailyFuelingSchedule(targetDate, stationId)
      }

      const result = await getDailyFuelingSchedule(targetDate, stationId)

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
        queryKey: dailyFuelingScheduleQueryKey(variables.targetDate, variables.stationId),
      })
      void queryClient.invalidateQueries({ queryKey: ['today-queue'] })
    },
  })
}
