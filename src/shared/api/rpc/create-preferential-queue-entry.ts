import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import type { FuelType } from '@/shared/constants'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import type { RpcResult } from './index'

export type PreferentialQueueEntryStatus = 'ACTIVE' | 'FUELED' | 'CANCELLED'

export type CreatePreferentialQueueEntryParams = {
  queueId: string
  plateNumber: string
  driverFullName: string
  driverPhone?: string
  fuelType: FuelType
  requestedLiters: number
  comment?: string
  clientMutationId: string
}

export type CreatePreferentialQueueEntryResult = {
  id: string
  queue_id: string
  queue_name: string
  vehicle_id: string
  driver_id: string | null
  normalized_plate_number: string
  driver_full_name: string
  driver_phone: string | null
  fuel_type: FuelType
  requested_liters: number
  status: PreferentialQueueEntryStatus
  comment: string | null
  client_mutation_id: string
  created_at: string
  updated_at: string
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

export function parseCreatePreferentialQueueEntryResult(
  value: unknown,
): CreatePreferentialQueueEntryResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<CreatePreferentialQueueEntryResult>

  if (
    typeof result.id === 'string' &&
    typeof result.queue_id === 'string' &&
    typeof result.queue_name === 'string' &&
    typeof result.vehicle_id === 'string' &&
    typeof result.normalized_plate_number === 'string' &&
    typeof result.driver_full_name === 'string' &&
    typeof result.fuel_type === 'string' &&
    typeof result.status === 'string' &&
    typeof result.client_mutation_id === 'string' &&
    typeof result.created_at === 'string' &&
    typeof result.updated_at === 'string'
  ) {
    return {
      id: result.id,
      queue_id: result.queue_id,
      queue_name: result.queue_name,
      vehicle_id: result.vehicle_id,
      driver_id: result.driver_id ?? null,
      normalized_plate_number: result.normalized_plate_number,
      driver_full_name: result.driver_full_name,
      driver_phone: result.driver_phone ?? null,
      fuel_type: result.fuel_type as FuelType,
      requested_liters: toNumber(result.requested_liters),
      status: result.status as PreferentialQueueEntryStatus,
      comment: result.comment ?? null,
      client_mutation_id: result.client_mutation_id,
      created_at: result.created_at,
      updated_at: result.updated_at,
    }
  }

  return null
}

export async function createPreferentialQueueEntry({
  queueId,
  plateNumber,
  driverFullName,
  driverPhone,
  fuelType,
  requestedLiters,
  comment,
  clientMutationId,
}: CreatePreferentialQueueEntryParams): Promise<RpcResult<CreatePreferentialQueueEntryResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('create_preferential_queue_entry', {
    queue_id: queueId,
    plate_number: normalizePlateNumber(plateNumber),
    driver_full_name: driverFullName,
    driver_phone: driverPhone ?? null,
    fuel_type: fuelType,
    requested_liters: requestedLiters,
    comment: comment ?? null,
    client_mutation_id: clientMutationId,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseCreatePreferentialQueueEntryResult(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected create_preferential_queue_entry response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
