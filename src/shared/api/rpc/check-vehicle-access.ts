import { isSupabaseConfigured } from '@/shared/config/env'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
import type {
  CheckVehicleAccessParams,
  VehicleAccessResult,
} from '@/shared/types/vehicle-access'

import type { RpcResult } from './index'
import { requestProtectedRpcApi } from './protected-api'

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

  try {
    const data = await requestProtectedRpcApi(
      '/api/check-vehicle-access',
      {
        plateNumber: normalizePlateNumber(plateNumber),
        stationId,
        checkDate,
      },
      'Check vehicle access request failed.',
    )
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
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Check vehicle access request failed.',
    }
  }
}
