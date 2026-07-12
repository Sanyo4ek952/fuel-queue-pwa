import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
}))

vi.mock('@/shared/api/auth', () => ({ getAuthSession: mocks.getAuthSession }))
vi.mock('@/shared/config/env', () => ({ isSupabaseConfigured: true }))

import {
  buildCreateReservationCallLogPayload,
  createReservationCallLog,
  parseCreateReservationCallLogResult,
} from './create-reservation-call-log'

function createJsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('parseCreateReservationCallLogResult', () => {
  it('parses a valid create_reservation_call_log response', () => {
    expect(
      parseCreateReservationCallLogResult({
        id: 'call-id',
        reservation_id: 'reservation-id',
        status: 'CONTACTED',
        called_by_profile_id: 'profile-id',
        called_by_full_name: 'Operator',
        called_by_role: 'cashier',
        called_by_signature_name: 'Operator O.',
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
      called_by_full_name: 'Operator',
      called_by_role: 'cashier',
      called_by_signature_name: 'Operator O.',
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
  it('calls the protected API with the allocation id parameter', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        id: 'call-id',
        allocation_id: 'allocation-id',
        reservation_id: 'allocation-id',
        status: 'CONTACTED',
        called_by_profile_id: 'profile-id',
        called_by_full_name: 'Operator',
        called_by_role: 'cashier',
        called_by_signature_name: 'Operator O.',
        called_at: '2026-07-07T10:30:00.000Z',
        comment: null,
        client_mutation_id: 'mutation-id',
        sync_status: 'SYNCED',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createReservationCallLog({
      allocationId: 'allocation-id',
      status: 'CONTACTED',
      clientMutationId: 'mutation-id',
    })

    expect(result.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reservation-call-log',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          allocationId: 'allocation-id',
          status: 'CONTACTED',
          comment: null,
          clientMutationId: 'mutation-id',
        }),
      }),
    )
  })

  it('returns the protected API error message', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createJsonResponse({ error: 'ALLOCATION_NOT_ACTIVE' }, 409)))

    const result = await createReservationCallLog({
      allocationId: 'allocation-id',
      status: 'CONTACTED',
      clientMutationId: 'mutation-id',
    })

    expect(result).toEqual({
      data: null,
      error: 'ALLOCATION_NOT_ACTIVE',
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
