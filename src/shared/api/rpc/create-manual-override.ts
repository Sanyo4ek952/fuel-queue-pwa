import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import type { SyncStatus } from '@/shared/constants'

import type { RpcResult } from './index'

export type CreateManualOverrideParams = {
  targetDate: string
  stationId: string
  plateNumber: string
  reason: string
  expiresAt?: string
  clientMutationId: string
}

export type CreateManualOverrideResult = {
  id: string
  date: string
  station_id: string
  vehicle_id: string
  normalized_plate_number: string
  reason: string
  approved_by: string
  expires_at: string | null
  used_at: string | null
  client_mutation_id: string
  sync_status: SyncStatus
}

export function parseCreateManualOverrideResult(
  value: unknown,
): CreateManualOverrideResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<CreateManualOverrideResult>

  if (
    typeof result.id === 'string' &&
    typeof result.date === 'string' &&
    typeof result.station_id === 'string' &&
    typeof result.vehicle_id === 'string' &&
    typeof result.normalized_plate_number === 'string' &&
    typeof result.reason === 'string' &&
    typeof result.approved_by === 'string' &&
    typeof result.client_mutation_id === 'string' &&
    typeof result.sync_status === 'string'
  ) {
    return {
      id: result.id,
      date: result.date,
      station_id: result.station_id,
      vehicle_id: result.vehicle_id,
      normalized_plate_number: result.normalized_plate_number,
      reason: result.reason,
      approved_by: result.approved_by,
      expires_at: result.expires_at ?? null,
      used_at: result.used_at ?? null,
      client_mutation_id: result.client_mutation_id,
      sync_status: result.sync_status as SyncStatus,
    }
  }

  return null
}

export async function createManualOverride({
  targetDate,
  stationId,
  plateNumber,
  reason,
  expiresAt,
  clientMutationId,
}: CreateManualOverrideParams): Promise<RpcResult<CreateManualOverrideResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('create_manual_override', {
    target_date: targetDate,
    target_station_id: stationId,
    plate_number: plateNumber,
    reason,
    expires_at: expiresAt ?? null,
    client_mutation_id: clientMutationId,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseCreateManualOverrideResult(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected create_manual_override response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
