import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import type {
  CheckVehicleAccessParams,
  VehicleAccessResult,
} from '@/shared/types/vehicle-access'

import type { RpcResult } from './index'

export type { CheckVehicleAccessParams, VehicleAccessResult }

function toVehicleAccessResult(value: unknown): VehicleAccessResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<VehicleAccessResult>

  if (
    (result.status === 'ALLOWED' || result.status === 'BLOCKED' || result.status === 'WARNING') &&
    typeof result.reason === 'string' &&
    typeof result.normalized_plate_number === 'string'
  ) {
    return result as VehicleAccessResult
  }

  return null
}

export async function checkVehicleAccess({
  plateNumber,
  stationId,
  checkDate,
}: CheckVehicleAccessParams): Promise<RpcResult<VehicleAccessResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('check_vehicle_access', {
    plate_number: plateNumber,
    station_id: stationId,
    check_date: checkDate,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = toVehicleAccessResult(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected check_vehicle_access response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
