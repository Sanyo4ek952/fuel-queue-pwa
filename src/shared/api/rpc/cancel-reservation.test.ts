import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

import { parseCancelReservationResult } from './cancel-reservation'

describe('parseCancelReservationResult', () => {
  it('parses a valid cancel_reservation response', () => {
    expect(
      parseCancelReservationResult({
        id: 'reservation-id',
        date: '2026-07-09',
        station_id: 'station-id',
        vehicle_id: 'vehicle-id',
        queue_number: 42,
        status: 'CANCELLED',
        sync_status: 'SYNCED',
        cancelled_by: 'profile-id',
        cancelled_at: '2026-07-09T10:00:00.000Z',
        cancel_reason: 'OTHER',
        cancel_comment: 'Дубль',
        updated_at: '2026-07-09T10:00:00.000Z',
      }),
    ).toEqual({
      id: 'reservation-id',
      date: '2026-07-09',
      station_id: 'station-id',
      vehicle_id: 'vehicle-id',
      queue_number: 42,
      status: 'CANCELLED',
      sync_status: 'SYNCED',
      cancelled_by: 'profile-id',
      cancelled_at: '2026-07-09T10:00:00.000Z',
      cancel_reason: 'OTHER',
      cancel_comment: 'Дубль',
      updated_at: '2026-07-09T10:00:00.000Z',
    })
  })

  it('rejects an incomplete cancel_reservation response', () => {
    expect(parseCancelReservationResult({ id: 'reservation-id' })).toBeNull()
  })
})
