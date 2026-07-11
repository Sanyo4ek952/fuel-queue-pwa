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

import {
  isActiveLocalQueueRow,
  mergeTodayQueueRows,
  type TodayQueueRow,
} from './use-today-queue'

function makeQueueRow(overrides: Partial<TodayQueueRow> = {}): TodayQueueRow {
  return {
    id: 'queue-row-id',
    date: null,
    station_id: null,
    vehicle_id: 'vehicle-id',
    driver_id: null,
    created_by_profile_id: 'profile-id',
    created_by_full_name: 'Operator',
    created_by_role: 'cashier',
    created_by_signature_name: null,
    queue_number: 1,
    ticket_number: 1,
    current_position: 1,
    people_ahead: 0,
    normalized_plate_number: 'A123BC777',
    driver_full_name: 'Ivan Ivanov',
    driver_phone: '+79990000000',
    fuel_type: 'AI_95',
    requested_liters: 40,
    status: 'RESERVED',
    sync_status: 'SYNCED',
    comment: null,
    client_mutation_id: null,
    is_offline: false,
    is_within_today_limit: true,
    latest_call_status: null,
    latest_called_by_profile_id: null,
    latest_called_by_full_name: '',
    latest_called_by_role: null,
    latest_called_by_signature_name: null,
    latest_called_at: null,
    latest_call_comment: null,
    latest_call_client_mutation_id: null,
    latest_call_sync_status: null,
    ...overrides,
  }
}

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

describe('mergeTodayQueueRows', () => {
  it('keeps server row order even when queue positions are not ascending', () => {
    const onlineRows = [
      makeQueueRow({
        id: 'server-first',
        ticket_number: 20,
        current_position: 8,
        daily_position: 8,
      }),
      makeQueueRow({
        id: 'server-second',
        ticket_number: 3,
        current_position: 1,
        daily_position: 1,
      }),
      makeQueueRow({
        id: 'server-third',
        ticket_number: 12,
        current_position: 5,
        daily_position: 5,
      }),
    ]

    expect(mergeTodayQueueRows(onlineRows, []).map((row) => row.id)).toEqual([
      'server-first',
      'server-second',
      'server-third',
    ])
  })

  it('appends unsynced local rows after server rows without resorting the list', () => {
    const onlineRows = [
      makeQueueRow({ id: 'server-first', ticket_number: 20 }),
      makeQueueRow({
        id: 'server-second',
        ticket_number: 3,
        client_mutation_id: 'synced-mutation',
      }),
    ]
    const localRows = [
      makeQueueRow({
        id: 'local-unsynced',
        ticket_number: 1,
        sync_status: 'PENDING',
        client_mutation_id: 'local-mutation',
        is_offline: true,
      }),
      makeQueueRow({
        id: 'local-already-returned-by-server',
        ticket_number: 2,
        sync_status: 'PENDING',
        client_mutation_id: 'synced-mutation',
        is_offline: true,
      }),
    ]

    expect(mergeTodayQueueRows(onlineRows, localRows).map((row) => row.id)).toEqual([
      'server-first',
      'server-second',
      'local-unsynced',
    ])
  })
})
