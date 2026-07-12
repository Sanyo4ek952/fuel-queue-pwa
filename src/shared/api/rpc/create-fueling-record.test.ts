import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
}))

vi.mock('@/shared/api/auth', () => ({ getAuthSession: mocks.getAuthSession }))
vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

import {
  createFuelingRecord,
  parseCreateFuelingRecordResult,
} from './create-fueling-record'

function createJsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function createFuelingRecordResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fueling-id',
    date: '2026-07-05',
    station_id: 'station-id',
    vehicle_id: 'vehicle-id',
    driver_id: null,
    reservation_id: 'reservation-id',
    allocation_id: 'allocation-id',
    queue_entry_id: null,
    preferential_queue_entry_id: null,
    fuel_type: 'AI_95',
    liters: 20,
    is_manual_override: false,
    override_id: null,
    client_mutation_id: 'mutation-id',
    sync_status: 'SYNCED',
    fueled_at: '2026-07-05T10:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('parseCreateFuelingRecordResult', () => {
  it('parses a valid create_fueling_record response', () => {
    expect(
      parseCreateFuelingRecordResult({
        id: 'fueling-id',
        date: '2026-07-05',
        station_id: 'station-id',
        vehicle_id: 'vehicle-id',
        driver_id: null,
        reservation_id: 'reservation-id',
        allocation_id: 'allocation-id',
        queue_entry_id: null,
        preferential_queue_entry_id: 'preferential-entry-id',
        fuel_type: 'AI_95',
        liters: '42.50',
        is_manual_override: false,
        override_id: null,
        client_mutation_id: 'mutation-id',
        sync_status: 'SYNCED',
        fueled_at: '2026-07-05T10:00:00.000Z',
      }),
    ).toMatchObject({
      id: 'fueling-id',
      fuel_type: 'AI_95',
      allocation_id: 'allocation-id',
      liters: 42.5,
      sync_status: 'SYNCED',
      preferential_queue_entry_id: 'preferential-entry-id',
    })
  })

  it('returns null for an unexpected response', () => {
    expect(parseCreateFuelingRecordResult({ id: 'fueling-id' })).toBeNull()
  })
})

describe('createFuelingRecord', () => {
  it('calls the protected preferential fueling API when preferential queue entry id is provided', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(
        createFuelingRecordResponse({
          reservation_id: null,
          allocation_id: null,
          preferential_queue_entry_id: 'preferential-entry-id',
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createFuelingRecord({
      preferentialQueueEntryId: 'preferential-entry-id',
      stationId: 'station-id',
      plateNumber: 'A123BC777',
      liters: 20,
      fuelType: 'AI_95',
      targetDate: '2026-07-05',
      fueledAt: '2026-07-05T10:00:00.000Z',
      comment: 'ok',
      clientMutationId: 'mutation-id',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/create-fueling-record-for-preferential-entry',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        body: JSON.stringify({
          preferentialQueueEntryId: 'preferential-entry-id',
          stationId: 'station-id',
          liters: 20,
          fueledAt: '2026-07-05T10:00:00.000Z',
          comment: 'ok',
          clientMutationId: 'mutation-id',
        }),
      }),
    )
    expect(result.data?.preferential_queue_entry_id).toBe('preferential-entry-id')
  })

  it('calls the protected allocation fueling API for regular allocations', async () => {
    mocks.getAuthSession.mockResolvedValue({
      data: { access_token: 'access-token' },
      error: null,
    })
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(createFuelingRecordResponse()))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createFuelingRecord({
      allocationId: 'allocation-id',
      stationId: 'station-id',
      plateNumber: 'A123BC777',
      liters: 20,
      fuelType: 'AI_95',
      targetDate: '2026-07-05',
      fueledAt: '2026-07-05T10:00:00.000Z',
      comment: undefined,
      clientMutationId: 'mutation-id',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/create-fueling-record-for-allocation',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        body: JSON.stringify({
          allocationId: 'allocation-id',
          liters: 20,
          fueledAt: '2026-07-05T10:00:00.000Z',
          comment: null,
          clientMutationId: 'mutation-id',
        }),
      }),
    )
    expect(result.data?.allocation_id).toBe('allocation-id')
  })
})
