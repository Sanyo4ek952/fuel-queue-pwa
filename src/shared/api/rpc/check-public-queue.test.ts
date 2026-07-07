import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import { parsePublicQueueCheckResult } from './check-public-queue'

describe('parsePublicQueueCheckResult', () => {
  it('parses a found queue position', () => {
    expect(
      parsePublicQueueCheckResult({
        status: 'FOUND',
        queue_number: '12',
        is_within_today_limit: true,
        remaining_attempts: '4',
      }),
    ).toEqual({
      status: 'FOUND',
      queue_number: 12,
      preferred_fuel_type: null,
      fuel_preference_mode: null,
      public_status: 'WAIT_FOR_CALL',
      is_within_today_limit: true,
      is_callable_now: null,
      matched_fuel_type: null,
      remaining_attempts: 4,
    })
  })

  it('parses a found queue position outside the current daily limit', () => {
    expect(
      parsePublicQueueCheckResult({
        status: 'FOUND',
        queue_number: '15',
        is_within_today_limit: false,
        remaining_attempts: '2',
      }),
    ).toEqual({
      status: 'FOUND',
      queue_number: 15,
      preferred_fuel_type: null,
      fuel_preference_mode: null,
      public_status: 'QUEUE_NOT_READY',
      is_within_today_limit: false,
      is_callable_now: null,
      matched_fuel_type: null,
      remaining_attempts: 2,
    })
  })

  it('parses a missing queue position', () => {
    expect(
      parsePublicQueueCheckResult({
        status: 'NOT_FOUND',
        queue_number: null,
        is_within_today_limit: null,
        remaining_attempts: 3,
      }),
    ).toEqual({
      status: 'NOT_FOUND',
      queue_number: null,
      preferred_fuel_type: null,
      fuel_preference_mode: null,
      public_status: 'NOT_FOUND',
      is_within_today_limit: null,
      is_callable_now: null,
      matched_fuel_type: null,
      remaining_attempts: 3,
    })
  })

  it('parses a limit exceeded response', () => {
    expect(
      parsePublicQueueCheckResult({
        status: 'LIMIT_EXCEEDED',
        queue_number: null,
        is_within_today_limit: null,
        remaining_attempts: 0,
      }),
    ).toEqual({
      status: 'LIMIT_EXCEEDED',
      queue_number: null,
      preferred_fuel_type: null,
      fuel_preference_mode: null,
      public_status: 'LIMIT_EXCEEDED',
      is_within_today_limit: null,
      is_callable_now: null,
      matched_fuel_type: null,
      remaining_attempts: 0,
    })
  })

  it('returns null for an unexpected response', () => {
    expect(parsePublicQueueCheckResult({ queue_number: 1 })).toBeNull()
  })
})
