import { useMutation, useQueryClient } from '@tanstack/react-query'

import { todayQueueQueryKey, type TodayQueueRow } from '@/entities/reservation'
import {
  updateReservationFuelPreference,
  type UpdateReservationFuelPreferenceParams,
  type UpdateReservationFuelPreferenceResult,
} from '@/shared/api/rpc'
import { offlineDb } from '@/shared/lib/offline-db'
import { useOnlineStatus } from '@/shared/lib/sync'

export type {
  UpdateReservationFuelPreferenceParams,
  UpdateReservationFuelPreferenceResult,
}

const updateReservationFuelPreferenceErrorMessages: Record<string, string> = {
  FUEL_PREFERENCE_LOCKED_BY_ACTIVE_GASOLINE_LIMIT:
    'Топливо нельзя изменить, пока по бензину установлен ненулевой лимит.',
  FUEL_PREFERENCE_LOCKED_BY_OPEN_LIMIT:
    'Топливо нельзя изменить после открытия лимитов на сегодня.',
}

function getUpdateReservationFuelPreferenceErrorMessage(error: string) {
  return updateReservationFuelPreferenceErrorMessages[error] ?? error
}

export function useUpdateReservationFuelPreference() {
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: UpdateReservationFuelPreferenceParams) => {
      if (!isOnline) {
        throw new Error('OFFLINE_UNAVAILABLE')
      }

      const result = await updateReservationFuelPreference(params)

      if (result.error || !result.data) {
        throw new Error(
          result.error
            ? getUpdateReservationFuelPreferenceErrorMessage(result.error)
            : 'UPDATE_RESERVATION_FUEL_PREFERENCE_FAILED',
        )
      }

      return result.data
    },
    onSuccess: async (data) => {
      queryClient.setQueryData<TodayQueueRow[]>(todayQueueQueryKey(), (rows) =>
        rows?.map((row) =>
          row.id === data.id
            ? {
                ...row,
                fuel_type: data.fuel_type,
                preferred_fuel_type: data.fuel_type,
                fuel_preference_mode: data.fuel_preference_mode,
                queue_number: data.queue_number,
                status: data.status,
                sync_status: data.sync_status,
                updated_at: data.updated_at,
              }
            : row,
        ),
      )

      await offlineDb.local_reservations.update(data.id, {
        fuel_type: data.fuel_type,
        fuel_preference_mode: data.fuel_preference_mode,
        queue_number: data.queue_number,
        status: data.status,
        sync_status: data.sync_status,
        updated_at: data.updated_at,
      })

      void queryClient.invalidateQueries({ queryKey: todayQueueQueryKey() })
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'daily-limit-overview',
      })
    },
  })
}
