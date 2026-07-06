import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import { parseCreatePreferentialQueueResult } from './create-preferential-queue'

describe('parseCreatePreferentialQueueResult', () => {
  it('parses a valid create_preferential_queue response', () => {
    expect(
      parseCreatePreferentialQueueResult({
        id: 'queue-id',
        name: 'Врачи',
        status: 'ACTIVE',
        created_by: 'profile-id',
        client_mutation_id: 'mutation-id',
        created_at: '2026-07-07T00:00:00.000Z',
        updated_at: '2026-07-07T00:00:00.000Z',
      }),
    ).toEqual({
      id: 'queue-id',
      name: 'Врачи',
      status: 'ACTIVE',
      created_by: 'profile-id',
      client_mutation_id: 'mutation-id',
      created_at: '2026-07-07T00:00:00.000Z',
      updated_at: '2026-07-07T00:00:00.000Z',
    })
  })

  it('rejects an invalid response', () => {
    expect(parseCreatePreferentialQueueResult({ id: 'queue-id' })).toBeNull()
  })
})
