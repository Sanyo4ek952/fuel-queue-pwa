import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

vi.mock('@/shared/lib/date', () => ({
  getTodayDateInputValue: () => '2026-07-08',
}))

vi.mock('@/shared/lib/offline-db', () => ({
  offlineDb: {
    local_reservations: {
      bulkPut: vi.fn(),
    },
  },
}))

import { listTodayQueueRows } from './index'

describe('listTodayQueueRows', () => {
  it('requests the today call list for the local app date', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { status: 'SYNCED' }, error: null })
      .mockResolvedValueOnce({ data: [], error: null })

    await expect(listTodayQueueRows()).resolves.toEqual([])

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'apply_reservation_no_show_policy')
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'get_today_call_list', {
      target_date: '2026-07-08',
    })
  })
})
