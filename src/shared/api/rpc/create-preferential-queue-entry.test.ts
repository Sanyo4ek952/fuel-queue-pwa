import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import { parseCreatePreferentialQueueEntryResult } from './create-preferential-queue-entry'

describe('parseCreatePreferentialQueueEntryResult', () => {
  it('parses a valid create_preferential_queue_entry response', () => {
    expect(
      parseCreatePreferentialQueueEntryResult({
        id: 'entry-id',
        queue_id: 'queue-id',
        queue_name: 'Врачи',
        vehicle_id: 'vehicle-id',
        driver_id: 'driver-id',
        normalized_plate_number: 'A123BC777',
        driver_full_name: 'Иванов Иван',
        driver_phone: null,
        fuel_type: 'AI_95',
        requested_liters: '35.5',
        status: 'ACTIVE',
        comment: null,
        client_mutation_id: 'mutation-id',
        created_at: '2026-07-07T00:00:00.000Z',
        updated_at: '2026-07-07T00:00:00.000Z',
      }),
    ).toMatchObject({
      id: 'entry-id',
      queue_id: 'queue-id',
      queue_name: 'Врачи',
      normalized_plate_number: 'A123BC777',
      requested_liters: 35.5,
      status: 'ACTIVE',
    })
  })

  it('rejects an invalid response', () => {
    expect(parseCreatePreferentialQueueEntryResult({ id: 'entry-id' })).toBeNull()
  })
})
