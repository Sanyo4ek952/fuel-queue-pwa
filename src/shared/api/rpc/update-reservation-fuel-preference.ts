import { isSupabaseConfigured } from '@/shared/config/env'
import type { FuelPreferenceMode, QueueFuelType, ReservationStatus, SyncStatus } from '@/shared/constants'

import type { RpcResult } from './index'
import { requestProtectedRpcApi } from './protected-api'

export type UpdateReservationFuelPreferenceParams = {
  reservationId: string
  fuelType: QueueFuelType
  fuelPreferenceMode: FuelPreferenceMode
  clientMutationId: string
}

export type UpdateReservationFuelPreferenceResult = {
  id: string
  date: string | null
  station_id: string | null
  vehicle_id: string
  fuel_type: QueueFuelType
  fuel_preference_mode: FuelPreferenceMode
  queue_number: number
  status: ReservationStatus
  client_mutation_id: string
  sync_status: SyncStatus
  updated_at: string
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

export function parseUpdateReservationFuelPreferenceResult(
  value: unknown,
): UpdateReservationFuelPreferenceResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<UpdateReservationFuelPreferenceResult>

  if (
    typeof result.id === 'string' &&
    typeof result.vehicle_id === 'string' &&
    typeof result.fuel_type === 'string' &&
    typeof result.fuel_preference_mode === 'string' &&
    result.queue_number != null &&
    typeof result.status === 'string' &&
    typeof result.client_mutation_id === 'string' &&
    typeof result.sync_status === 'string' &&
    typeof result.updated_at === 'string'
  ) {
    return {
      id: result.id,
      date: result.date ?? null,
      station_id: result.station_id ?? null,
      vehicle_id: result.vehicle_id,
      fuel_type: result.fuel_type as QueueFuelType,
      fuel_preference_mode: result.fuel_preference_mode as FuelPreferenceMode,
      queue_number: toNumber(result.queue_number),
      status: result.status as ReservationStatus,
      client_mutation_id: result.client_mutation_id,
      sync_status: result.sync_status as SyncStatus,
      updated_at: result.updated_at,
    }
  }

  return null
}

export async function updateReservationFuelPreference({
  reservationId,
  fuelType,
  fuelPreferenceMode,
  clientMutationId,
}: UpdateReservationFuelPreferenceParams): Promise<
  RpcResult<UpdateReservationFuelPreferenceResult>
> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/update-reservation-fuel-preference',
      {
        reservationId,
        fuelType,
        fuelPreferenceMode,
        clientMutationId,
      },
      'Update reservation fuel preference request failed.',
    )
    const parsed = parseUpdateReservationFuelPreferenceResult(data)

    if (!parsed) {
      return {
        data: null,
        error: 'Unexpected update_reservation_fuel_preference response.',
      }
    }

    return {
      data: parsed,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error ? error.message : 'Update reservation fuel preference request failed.',
    }
  }
}
