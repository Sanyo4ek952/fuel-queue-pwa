import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import type { RpcResult } from './index'

export type CreatePersonalVehicleLiterLimitParams = {
  targetDate: string
  plateNumber: string
  liters: number
  comment?: string
  clientMutationId: string
}

export type CreatePersonalVehicleLiterLimitResult = {
  id: string
  date: string
  vehicle_id: string
  normalized_plate_number: string
  liters: number
  comment: string | null
  client_mutation_id: string
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

export function parseCreatePersonalVehicleLiterLimitResult(
  value: unknown,
): CreatePersonalVehicleLiterLimitResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<CreatePersonalVehicleLiterLimitResult>

  if (
    typeof result.id === 'string' &&
    typeof result.date === 'string' &&
    typeof result.vehicle_id === 'string' &&
    typeof result.normalized_plate_number === 'string' &&
    typeof result.client_mutation_id === 'string'
  ) {
    return {
      id: result.id,
      date: result.date,
      vehicle_id: result.vehicle_id,
      normalized_plate_number: result.normalized_plate_number,
      liters: toNumber(result.liters),
      comment: result.comment ?? null,
      client_mutation_id: result.client_mutation_id,
    }
  }

  return null
}

export async function createPersonalVehicleLiterLimit({
  targetDate,
  plateNumber,
  liters,
  comment,
  clientMutationId,
}: CreatePersonalVehicleLiterLimitParams): Promise<
  RpcResult<CreatePersonalVehicleLiterLimitResult>
> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('create_personal_vehicle_liter_limit', {
    target_date: targetDate,
    plate_number: normalizePlateNumber(plateNumber),
    liters,
    comment: comment ?? null,
    client_mutation_id: clientMutationId,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseCreatePersonalVehicleLiterLimitResult(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected create_personal_vehicle_liter_limit response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
