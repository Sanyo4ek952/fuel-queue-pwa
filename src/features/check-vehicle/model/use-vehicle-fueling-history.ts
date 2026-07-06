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

export const vehicleFuelingHistoryQueryKey = (
  plateNumber: string,
  isOnline: boolean,
  pageSize = VEHICLE_FUELING_HISTORY_PAGE_SIZE,
) => ['vehicle-fueling-history', plateNumber, isOnline, pageSize] as const

export function useVehicleFuelingHistory({
  plateNumber,
  enabled,
  pageSize = VEHICLE_FUELING_HISTORY_PAGE_SIZE,
}: {
  plateNumber: string
  enabled: boolean
  pageSize?: number
}) {
  const isOnline = useOnlineStatus()

  return useInfiniteQuery({
    queryKey: vehicleFuelingHistoryQueryKey(plateNumber, isOnline, pageSize),
    enabled: enabled && Boolean(plateNumber),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params: GetVehicleFuelingHistoryParams = {
        plateNumber,
        pageLimit: pageSize,
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
      lastPage.has_more ? allPages.length * pageSize : undefined,
  })
}
