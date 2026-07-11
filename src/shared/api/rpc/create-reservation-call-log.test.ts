import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import { parseCreateReservationCallLogResult } from './create-reservation-call-log'

describe('parseCreateReservationCallLogResult', () => {
  it('parses a valid create_reservation_call_log response', () => {
    expect(
      parseCreateReservationCallLogResult({
        id: 'call-id',
        reservation_id: 'reservation-id',
        status: 'CONTACTED',
        called_by_profile_id: 'profile-id',
        called_by_full_name: 'Мария Петрова',
        called_by_role: 'cashier',
        called_by_signature_name: 'Петрова М.',
        called_at: '2026-07-07T10:30:00.000Z',
        comment: null,
        client_mutation_id: 'mutation-id',
        sync_status: 'SYNCED',
      }),
    ).toMatchObject({
      id: 'call-id',
      reservation_id: 'reservation-id',
      status: 'CONTACTED',
      called_by_profile_id: 'profile-id',
      called_by_full_name: 'Мария Петрова',
      called_by_role: 'cashier',
      called_by_signature_name: 'Петрова М.',
      called_at: '2026-07-07T10:30:00.000Z',
      comment: null,
      client_mutation_id: 'mutation-id',
      sync_status: 'SYNCED',
    })
  })

  it('rejects an invalid response', () => {
    expect(parseCreateReservationCallLogResult({ id: 'call-id' })).toBeNull()
  })
})
