import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

vi.mock('@/shared/lib/offline-db', () => ({
  offlineDb: {
    local_reservations: {
      toArray: vi.fn(),
      bulkPut: vi.fn(),
    },
  },
}))

import { isActiveLocalQueueRow } from './use-today-queue'

describe('isActiveLocalQueueRow', () => {
  it('keeps active queue rows regardless of reservation date', () => {
    expect(isActiveLocalQueueRow({ status: 'RESERVED' })).toBe(true)
    expect(isActiveLocalQueueRow({ status: 'ARRIVED' })).toBe(true)
    expect(isActiveLocalQueueRow({ status: 'APPROVED' })).toBe(true)
    expect(isActiveLocalQueueRow({ status: 'FUELING' })).toBe(true)
  })

  it('filters completed and inactive queue rows', () => {
    expect(isActiveLocalQueueRow({ status: 'FUELED' })).toBe(false)
    expect(isActiveLocalQueueRow({ status: 'CANCELLED' })).toBe(false)
    expect(isActiveLocalQueueRow({ status: 'NO_SHOW' })).toBe(false)
  })
})
