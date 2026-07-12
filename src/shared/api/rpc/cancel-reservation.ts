import { isSupabaseConfigured } from '@/shared/config/env'
import type { ReservationStatus, SyncStatus } from '@/shared/constants'

import type { RpcResult } from './index'
import { requestProtectedRpcApi } from './protected-api'

export const CANCEL_RESERVATION_REASONS = ['OWNER_CANCELLED', 'OTHER'] as const

export type CancelReservationReason = (typeof CANCEL_RESERVATION_REASONS)[number]

export type CancelReservationParams = {
  reservationId: string
  reason: CancelReservationReason
  comment: string | null
  clientMutationId: string
}

export type CancelReservationResult = {
  id: string
  date: string | null
  station_id: string | null
  vehicle_id: string
  queue_number: number
  status: ReservationStatus
  sync_status: SyncStatus
  cancelled_by: string
  cancelled_at: string
  cancel_reason: CancelReservationReason
  cancel_comment: string | null
  updated_at: string
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

export function parseCancelReservationResult(value: unknown): CancelReservationResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<CancelReservationResult>

  if (
    typeof result.id === 'string' &&
    typeof result.vehicle_id === 'string' &&
    result.queue_number != null &&
    typeof result.status === 'string' &&
    typeof result.sync_status === 'string' &&
    typeof result.cancelled_by === 'string' &&
    typeof result.cancelled_at === 'string' &&
    typeof result.cancel_reason === 'string' &&
    typeof result.updated_at === 'string'
  ) {
    return {
      id: result.id,
      date: result.date ?? null,
      station_id: result.station_id ?? null,
      vehicle_id: result.vehicle_id,
      queue_number: toNumber(result.queue_number),
      status: result.status as ReservationStatus,
      sync_status: result.sync_status as SyncStatus,
      cancelled_by: result.cancelled_by,
      cancelled_at: result.cancelled_at,
      cancel_reason: result.cancel_reason as CancelReservationReason,
      cancel_comment: result.cancel_comment ?? null,
      updated_at: result.updated_at,
    }
  }

  return null
}

export async function cancelReservation({
  reservationId,
  reason,
  comment,
  clientMutationId,
}: CancelReservationParams): Promise<RpcResult<CancelReservationResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/cancel-reservation',
      {
        reservationId,
        reason,
        comment,
        clientMutationId,
      },
      'Cancel reservation request failed.',
    )
    const parsed = parseCancelReservationResult(data)

    if (!parsed) {
      return {
        data: null,
        error: 'Unexpected cancel_reservation response.',
      }
    }

    return {
      data: parsed,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Cancel reservation request failed.',
    }
  }
}
