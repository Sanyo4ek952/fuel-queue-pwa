import { useMutation } from '@tanstack/react-query'

import { getVehicleFuelingHistory } from '@/shared/api/rpc'
import {
  getVehicleFuelingHistoryOffline,
  markFuelingHistoryOfflineResult,
} from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'
import type {
  GetVehicleFuelingHistoryParams,
  VehicleFuelingHistoryResult,
} from '@/shared/types/vehicle-fueling-history'

export type { GetVehicleFuelingHistoryParams, VehicleFuelingHistoryResult }

export function useVehicleFuelingHistory() {
  const isOnline = useOnlineStatus()

  return useMutation({
    mutationFn: async (params: GetVehicleFuelingHistoryParams) => {
      if (isOnline) {
        try {
          const result = await getVehicleFuelingHistory(params)

          if (result.data) {
            return result.data
          }

          const offlineResult = await getVehicleFuelingHistoryOffline(params)
          return markFuelingHistoryOfflineResult(offlineResult, result.error ?? undefined)
        } catch (error) {
          const offlineResult = await getVehicleFuelingHistoryOffline(params)
          return markFuelingHistoryOfflineResult(
            offlineResult,
            error instanceof Error ? error.message : 'Online history check failed.',
          )
        }
      }

      const offlineResult = await getVehicleFuelingHistoryOffline(params)
      return markFuelingHistoryOfflineResult(offlineResult)
    },
  })
}
