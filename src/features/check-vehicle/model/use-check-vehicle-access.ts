import { useMutation } from '@tanstack/react-query'

import {
  checkVehicleAccess,
  refreshVehicleAccessCache,
} from '@/shared/api/rpc'
import type {
  CheckVehicleAccessParams,
  VehicleAccessReason,
  VehicleAccessResult,
  VehicleAccessStatus,
} from '@/shared/types/vehicle-access'
import {
  checkVehicleAccessOffline,
  markOfflineResult,
} from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

export type {
  CheckVehicleAccessParams,
  VehicleAccessReason,
  VehicleAccessResult,
  VehicleAccessStatus,
}

export function useCheckVehicleAccess() {
  const isOnline = useOnlineStatus()

  return useMutation({
    mutationFn: async (params: CheckVehicleAccessParams) => {
      if (isOnline) {
        try {
          const result = await checkVehicleAccess(params)

          if (result.data) {
            void refreshVehicleAccessCache(params).catch(() => undefined)
            return result.data
          }

          const offlineResult = await checkVehicleAccessOffline(params)
          return markOfflineResult(offlineResult, result.error ?? undefined)
        } catch (error) {
          const offlineResult = await checkVehicleAccessOffline(params)
          return markOfflineResult(
            offlineResult,
            error instanceof Error ? error.message : 'Online check failed.',
          )
        }
      }

      const offlineResult = await checkVehicleAccessOffline(params)
      return markOfflineResult(offlineResult)
    },
  })
}
