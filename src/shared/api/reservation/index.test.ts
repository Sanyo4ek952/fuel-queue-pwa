import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import {
  listCancelledReservationsPage,
  listTodayQueueAuthors,
  listTodayQueueRows,
} from './index'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listTodayQueueRows', () => {
  it('requests the today call list for the local app date', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { status: 'SYNCED' }, error: null })
      .mockResolvedValueOnce({ data: [], error: null })

    await expect(listTodayQueueRows()).resolves.toEqual([])

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'apply_reservation_no_show_policy')
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'get_today_call_list', {
      target_date: '2026-07-08',
      page_size: 25,
      cursor_queue_number: null,
      cursor_id: null,
      plate_search: '',
      created_by_profile_id: null,
      call_filter: 'all',
      gasoline_fuel_filter: 'all',
    })
  })

  it('returns ticket number, current position and people ahead from the call list', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { status: 'SYNCED' }, error: null })
      .mockResolvedValueOnce({
        data: {
          rows: [
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
          next_cursor: null,
        },
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

describe('listCancelledReservationsPage', () => {
  it('requests one cursor page without date filters by default', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        rows: [],
        next_cursor: {
          cancelled_at: '2026-07-08T10:00:00.000Z',
          id: 'reservation-id',
        },
      },
      error: null,
    })

    await expect(
      listCancelledReservationsPage({
        pageSize: 25,
        cursor: {
          cancelled_at: '2026-07-08T11:00:00.000Z',
          id: 'cursor-id',
        },
        plateSearch: '123',
      }),
    ).resolves.toMatchObject({
      rows: [],
      nextCursor: {
        cancelled_at: '2026-07-08T10:00:00.000Z',
        id: 'reservation-id',
      },
    })

    expect(mocks.rpc).toHaveBeenCalledWith('get_cancelled_reservations', {
      page_size: 25,
      cursor_cancelled_at: '2026-07-08T11:00:00.000Z',
      cursor_id: 'cursor-id',
      plate_search: '123',
      date_from: null,
      date_to: null,
    })
  })
})

describe('listTodayQueueAuthors', () => {
  it('loads authors through a dedicated non-paginated RPC', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          user_id: 'profile-id',
          display_name: 'Петрова М.',
          role: 'cashier',
          signature_name: 'Петрова М.',
        },
      ],
      error: null,
    })

    await expect(
      listTodayQueueAuthors({
        plateSearch: '123',
        callFilter: 'call',
        gasolineFuelFilter: 'AI_95',
      }),
    ).resolves.toEqual([
      {
        userId: 'profile-id',
        displayName: 'Петрова М.',
        role: 'cashier',
        signatureName: 'Петрова М.',
      },
    ])

    expect(mocks.rpc).toHaveBeenCalledWith('get_today_queue_authors', {
      target_date: '2026-07-08',
      plate_search: '123',
      call_filter: 'call',
      gasoline_fuel_filter: 'AI_95',
    })
  })
})
