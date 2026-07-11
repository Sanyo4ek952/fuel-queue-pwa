import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

import { supabase } from '@/shared/api/supabase'

import {
  buildCreateReservationCallLogPayload,
  createReservationCallLog,
  parseCreateReservationCallLogResult,
} from './create-reservation-call-log'

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

describe('createReservationCallLog', () => {
  it('calls the RPC with the allocation id parameter', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      success: true,
      data: {
        id: 'call-id',
        allocation_id: 'allocation-id',
        reservation_id: 'allocation-id',
        status: 'CONTACTED',
        called_by_profile_id: 'profile-id',
        called_by_full_name: 'РњР°СЂРёСЏ РџРµС‚СЂРѕРІР°',
        called_by_role: 'cashier',
        called_by_signature_name: 'РџРµС‚СЂРѕРІР° Рњ.',
        called_at: '2026-07-07T10:30:00.000Z',
        comment: null,
        client_mutation_id: 'mutation-id',
        sync_status: 'SYNCED',
      },
      error: null,
      count: null,
      status: 200,
      statusText: 'OK',
    })

    const result = await createReservationCallLog({
      allocationId: 'allocation-id',
      status: 'CONTACTED',
      clientMutationId: 'mutation-id',
    })

    expect(result.error).toBeNull()
    expect(supabase.rpc).toHaveBeenCalledWith('create_reservation_call_log', {
      reservation_id: 'allocation-id',
      status: 'CONTACTED',
      comment: null,
      client_mutation_id: 'mutation-id',
    })
  })

  it('builds offline sync payloads with allocation_id', () => {
    expect(
      buildCreateReservationCallLogPayload({
        allocationId: 'allocation-id',
        status: 'NO_ANSWER',
        comment: 'later',
        clientMutationId: 'mutation-id',
      }),
    ).toEqual({
      allocation_id: 'allocation-id',
      status: 'NO_ANSWER',
      comment: 'later',
    })
  })
})
