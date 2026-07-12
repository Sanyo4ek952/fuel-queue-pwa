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
        ticket_number: '2847',
        current_position: '71',
        people_ahead: '70',
        fuel_queue_position: '23',
        is_within_today_limit: true,
        remaining_attempts: '4',
        retry_after_seconds: '0',
      }),
    ).toMatchObject({
      status: 'FOUND',
      queue_number: 2847,
      ticket_number: 2847,
      current_position: 71,
      people_ahead: 70,
      fuel_queue_position: 23,
      preferred_fuel_type: null,
      fuel_preference_mode: null,
      public_status: 'WAIT_FOR_CALL',
      is_within_today_limit: true,
      is_callable_now: null,
      matched_fuel_type: null,
      remaining_attempts: 4,
      retry_after_seconds: 0,
      error_code: null,
    })
  })

  it('parses a found queue position outside the current daily limit', () => {
    expect(
      parsePublicQueueCheckResult({
        status: 'FOUND',
        queue_number: '15',
        is_within_today_limit: false,
        remaining_attempts: '2',
        retry_after_seconds: 0,
      }),
    ).toMatchObject({
      status: 'FOUND',
      queue_number: 15,
      ticket_number: 15,
      current_position: null,
      people_ahead: null,
      fuel_queue_position: null,
      preferred_fuel_type: null,
      fuel_preference_mode: null,
      public_status: 'QUEUE_NOT_READY',
      is_within_today_limit: false,
      is_callable_now: null,
      matched_fuel_type: null,
      remaining_attempts: 2,
      retry_after_seconds: 0,
      error_code: null,
    })
  })

  it('parses a missing queue position', () => {
    expect(
      parsePublicQueueCheckResult({
        status: 'NOT_FOUND',
        queue_number: null,
        is_within_today_limit: null,
        remaining_attempts: 3,
        retry_after_seconds: 0,
      }),
    ).toMatchObject({
      status: 'NOT_FOUND',
      queue_number: null,
      ticket_number: null,
      current_position: null,
      people_ahead: null,
      fuel_queue_position: null,
      preferred_fuel_type: null,
      fuel_preference_mode: null,
      public_status: 'NOT_FOUND',
      is_within_today_limit: null,
      is_callable_now: null,
      matched_fuel_type: null,
      remaining_attempts: 3,
      retry_after_seconds: 0,
      error_code: null,
    })
  })

  it('parses a limit exceeded response', () => {
    expect(
      parsePublicQueueCheckResult({
        status: 'LIMIT_EXCEEDED',
        queue_number: null,
        is_within_today_limit: null,
        remaining_attempts: 0,
        retry_after_seconds: 1800,
        error_code: 'PUBLIC_QUEUE_IP_RATE_LIMITED',
      }),
    ).toMatchObject({
      status: 'LIMIT_EXCEEDED',
      queue_number: null,
      ticket_number: null,
      current_position: null,
      people_ahead: null,
      fuel_queue_position: null,
      preferred_fuel_type: null,
      fuel_preference_mode: null,
      public_status: 'LIMIT_EXCEEDED',
      is_within_today_limit: null,
      is_callable_now: null,
      matched_fuel_type: null,
      remaining_attempts: 0,
      retry_after_seconds: 1800,
      error_code: 'PUBLIC_QUEUE_IP_RATE_LIMITED',
    })
  })

  it('returns null for an unexpected response', () => {
    expect(parsePublicQueueCheckResult({ queue_number: 1 })).toBeNull()
  })

  it('returns null for an invalid fuel queue position', () => {
    expect(
      parsePublicQueueCheckResult({
        status: 'FOUND',
        queue_number: 1,
        fuel_queue_position: 0,
        is_within_today_limit: true,
        remaining_attempts: 3,
        retry_after_seconds: 0,
      }),
    ).toBeNull()
  })
})
