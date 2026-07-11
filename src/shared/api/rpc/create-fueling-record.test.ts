import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import { parseCreateFuelingRecordResult } from './create-fueling-record'

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
