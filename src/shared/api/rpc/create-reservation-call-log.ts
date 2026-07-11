import { isSupabaseConfigured } from '@/shared/config/env'
import type { UserRole } from '@/shared/config/roles'
import type { ReservationCallStatus, SyncStatus } from '@/shared/constants'
import { supabase } from '@/shared/api/supabase'

import type { RpcResult } from './index'

export type CreateReservationCallLogParams = {
  allocationId?: string
  reservationId?: string
  status: ReservationCallStatus
  comment?: string
  clientMutationId: string
}

export type CreateReservationCallLogResult = {
  id: string
  allocation_id: string
  reservation_id: string
  status: ReservationCallStatus
  called_by_profile_id: string
  called_by_full_name: string
  called_by_role: UserRole | string | null
  called_by_signature_name: string | null
  called_at: string
  comment: string | null
  client_mutation_id: string
  sync_status: SyncStatus
}

export type CreateReservationCallLogPayload = {
  allocation_id: string
  status: ReservationCallStatus
  comment?: string
}

function resolveAllocationId(params: Pick<CreateReservationCallLogParams, 'allocationId' | 'reservationId'>) {
  return params.allocationId ?? params.reservationId
}

export function buildCreateReservationCallLogPayload({
  allocationId,
  reservationId,
  status,
  comment,
}: CreateReservationCallLogParams): CreateReservationCallLogPayload {
  const resolvedAllocationId = resolveAllocationId({ allocationId, reservationId })

  if (!resolvedAllocationId) {
    throw new Error('ALLOCATION_ID_REQUIRED')
  }

  return {
    allocation_id: resolvedAllocationId,
    status,
    comment: comment || undefined,
  }
}

export function parseCreateReservationCallLogResult(
  value: unknown,
): CreateReservationCallLogResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<CreateReservationCallLogResult>

  if (
    typeof result.id === 'string' &&
    typeof result.reservation_id === 'string' &&
    typeof result.status === 'string' &&
    typeof result.called_by_profile_id === 'string' &&
    typeof result.called_at === 'string' &&
    typeof result.client_mutation_id === 'string'
  ) {
    return {
      id: result.id,
      allocation_id: result.allocation_id ?? result.reservation_id,
      reservation_id: result.reservation_id,
      status: result.status as ReservationCallStatus,
      called_by_profile_id: result.called_by_profile_id,
      called_by_full_name: result.called_by_full_name ?? '',
      called_by_role: result.called_by_role ?? null,
      called_by_signature_name: result.called_by_signature_name ?? null,
      called_at: result.called_at,
      comment: result.comment ?? null,
      client_mutation_id: result.client_mutation_id,
      sync_status: (result.sync_status ?? 'SYNCED') as SyncStatus,
    }
  }

  return null
}

export async function createReservationCallLog({
  allocationId,
  reservationId,
  status,
  comment,
  clientMutationId,
}: CreateReservationCallLogParams): Promise<RpcResult<CreateReservationCallLogResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const resolvedAllocationId = resolveAllocationId({ allocationId, reservationId })

  if (!resolvedAllocationId) {
    return {
      data: null,
      error: 'ALLOCATION_ID_REQUIRED',
    }
  }

  const { data, error } = await supabase.rpc('create_reservation_call_log', {
    reservation_id: resolvedAllocationId,
    status,
    comment: comment ?? null,
    client_mutation_id: clientMutationId,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseCreateReservationCallLogResult(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected create_reservation_call_log response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
