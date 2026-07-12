import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import type { FuelPreferenceMode, QueueFuelType } from '@/shared/constants'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import type { RpcResult } from './index'

export const PUBLIC_QUEUE_CHECK_STATUSES = [
  'FOUND',
  'NOT_FOUND',
  'LIMIT_EXCEEDED',
  'INVALID_INPUT',
] as const

export type PublicQueueCheckStatus = (typeof PUBLIC_QUEUE_CHECK_STATUSES)[number]

export const PUBLIC_QUEUE_STATUSES = [
  'QUEUE_NOT_READY',
  'WAITING_FOR_PREFERRED_FUEL',
  'IN_CALL_LIST',
  'WAIT_FOR_CALL',
  'PAUSED_BY_LIMIT',
  'INVITED_BY_OPERATOR',
  'COMPLETED_OR_CANCELLED',
  'NOT_FOUND',
  'INVALID_INPUT',
  'LIMIT_EXCEEDED',
] as const

export type PublicQueueStatus = (typeof PUBLIC_QUEUE_STATUSES)[number]

export type PublicQueueCheckResult = {
  status: PublicQueueCheckStatus
  queue_number: number | null
  ticket_number: number | null
  current_position: number | null
  people_ahead: number | null
  preferred_fuel_type: QueueFuelType | string | null
  fuel_preference_mode: FuelPreferenceMode | null
  public_status: PublicQueueStatus
  is_within_today_limit: boolean | null
  is_callable_now: boolean | null
  matched_fuel_type: QueueFuelType | string | null
  permanent_number: number | null
  allocation_status: string | null
  arrival_at: string | null
  remaining_attempts: number
  retry_after_seconds: number
  error_code: string | null
}

export type CheckPublicQueueParams = {
  plateNumber: string
  phoneLast4: string
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  const numericValue = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(numericValue) ? numericValue : null
}

function toNumber(value: unknown) {
  const numericValue = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(numericValue) ? numericValue : null
}

function toNullableBoolean(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'boolean') {
    return value
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  return null
}

export function parsePublicQueueCheckResult(value: unknown): PublicQueueCheckResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<PublicQueueCheckResult>
  const remainingAttempts = toNumber(result.remaining_attempts)
  const retryAfterSeconds = toNumber(result.retry_after_seconds)
  const ticketNumber = toNullableNumber(result.ticket_number) ?? toNullableNumber(result.queue_number)
  const currentPosition = toNullableNumber(result.current_position)
  const peopleAhead = toNullableNumber(result.people_ahead)
  const isWithinTodayLimit = toNullableBoolean(result.is_within_today_limit)
  const isCallableNow = toNullableBoolean(result.is_callable_now)
  const publicStatus =
    result.public_status ??
    (result.status === 'FOUND'
      ? isWithinTodayLimit
        ? 'WAIT_FOR_CALL'
        : 'QUEUE_NOT_READY'
      : result.status)

  if (
    PUBLIC_QUEUE_CHECK_STATUSES.includes(result.status as PublicQueueCheckStatus) &&
    PUBLIC_QUEUE_STATUSES.includes(publicStatus as PublicQueueStatus) &&
    remainingAttempts !== null &&
    retryAfterSeconds !== null &&
    (ticketNumber === null || ticketNumber > 0) &&
    (currentPosition === null || currentPosition > 0) &&
    (peopleAhead === null || peopleAhead >= 0)
  ) {
    return {
      status: result.status as PublicQueueCheckStatus,
      queue_number: ticketNumber,
      ticket_number: ticketNumber,
      current_position: currentPosition,
      people_ahead: peopleAhead,
      preferred_fuel_type: result.preferred_fuel_type ?? null,
      fuel_preference_mode: result.fuel_preference_mode ?? null,
      public_status: publicStatus as PublicQueueStatus,
      is_within_today_limit: isWithinTodayLimit,
      is_callable_now: isCallableNow,
      matched_fuel_type: result.matched_fuel_type ?? null,
      permanent_number: toNullableNumber(result.permanent_number) ?? ticketNumber,
      allocation_status: result.allocation_status ?? null,
      arrival_at: result.arrival_at ?? null,
      remaining_attempts: remainingAttempts,
      retry_after_seconds: retryAfterSeconds,
      error_code: typeof result.error_code === 'string' ? result.error_code : null,
    }
  }

  return null
}

export async function checkPublicQueuePosition({
  plateNumber,
  phoneLast4,
}: CheckPublicQueueParams): Promise<RpcResult<PublicQueueCheckResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('check_public_queue_position', {
    plate_number: normalizePlateNumber(plateNumber),
    phone_last4: phoneLast4,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parsePublicQueueCheckResult(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected check_public_queue_position response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
