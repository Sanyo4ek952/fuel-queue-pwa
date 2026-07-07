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

  it('returns ticket number, current position and people ahead from the call list', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { status: 'SYNCED' }, error: null })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'first-reservation-id',
            vehicle_id: 'first-vehicle-id',
            operator_id: 'profile-id',
            fuel_type: 'AI_92',
            requested_liters: 20,
            queue_number: 100,
            ticket_number: 100,
            current_position: 1,
            people_ahead: 0,
            status: 'RESERVED',
          },
          {
            id: 'reservation-id',
            vehicle_id: 'vehicle-id',
            operator_id: 'profile-id',
            fuel_type: 'AI_95',
            requested_liters: 40,
            queue_number: 2847,
            ticket_number: 2847,
            current_position: 2,
            people_ahead: 1,
            status: 'RESERVED',
          },
        ],
        error: null,
      })

    await expect(listTodayQueueRows()).resolves.toMatchObject([
      {
        id: 'first-reservation-id',
        queue_number: 100,
        ticket_number: 100,
        current_position: 1,
        people_ahead: 0,
      },
      {
        id: 'reservation-id',
        queue_number: 2847,
        ticket_number: 2847,
        current_position: 2,
        people_ahead: 1,
      },
    ])
  })
})
