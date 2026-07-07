import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import type { RpcResult } from './index'

export const PUBLIC_QUEUE_CHECK_STATUSES = [
  'FOUND',
  'NOT_FOUND',
  'LIMIT_EXCEEDED',
  'INVALID_INPUT',
] as const

export type PublicQueueCheckStatus = (typeof PUBLIC_QUEUE_CHECK_STATUSES)[number]

export type PublicQueueCheckResult = {
  status: PublicQueueCheckStatus
  queue_number: number | null
  is_within_today_limit: boolean | null
  remaining_attempts: number
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
  const queueNumber = toNullableNumber(result.queue_number)
  const isWithinTodayLimit = toNullableBoolean(result.is_within_today_limit)

  if (
    PUBLIC_QUEUE_CHECK_STATUSES.includes(result.status as PublicQueueCheckStatus) &&
    remainingAttempts !== null &&
    (queueNumber === null || queueNumber > 0)
  ) {
    return {
      status: result.status as PublicQueueCheckStatus,
      queue_number: queueNumber,
      is_within_today_limit: isWithinTodayLimit,
      remaining_attempts: remainingAttempts,
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
