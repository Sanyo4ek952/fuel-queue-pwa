import { useInfiniteQuery } from '@tanstack/react-query'

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

export const VEHICLE_FUELING_HISTORY_PAGE_SIZE = 10

export const vehicleFuelingHistoryQueryKey = (plateNumber: string, isOnline: boolean) =>
  ['vehicle-fueling-history', plateNumber, isOnline] as const

export function useVehicleFuelingHistory({
  plateNumber,
  enabled,
}: {
  plateNumber: string
  enabled: boolean
}) {
  const isOnline = useOnlineStatus()

  return useInfiniteQuery({
    queryKey: vehicleFuelingHistoryQueryKey(plateNumber, isOnline),
    enabled: enabled && Boolean(plateNumber),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params: GetVehicleFuelingHistoryParams = {
        plateNumber,
        pageLimit: VEHICLE_FUELING_HISTORY_PAGE_SIZE,
        pageOffset: pageParam,
      }

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
    getNextPageParam: (lastPage, allPages) =>
      lastPage.has_more ? allPages.length * VEHICLE_FUELING_HISTORY_PAGE_SIZE : undefined,
  })
}
