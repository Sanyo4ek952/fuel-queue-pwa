import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import { parseCancelPreferentialQueueEntryResult } from './cancel-preferential-queue-entry'

describe('parseCancelPreferentialQueueEntryResult', () => {
  it('parses a valid cancel_preferential_queue_entry response', () => {
    expect(
      parseCancelPreferentialQueueEntryResult({
        id: 'entry-id',
        queue_id: 'queue-id',
        status: 'CANCELLED',
        cancelled_comment: 'Отменено мэром',
        cancelled_at: '2026-07-07T00:00:00.000Z',
      }),
    ).toMatchObject({
      id: 'entry-id',
      queue_id: 'queue-id',
      status: 'CANCELLED',
      cancelled_comment: 'Отменено мэром',
    })
  })

  it('rejects an invalid response', () => {
    expect(parseCancelPreferentialQueueEntryResult({ id: 'entry-id' })).toBeNull()
  })
})
