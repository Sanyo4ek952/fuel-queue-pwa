import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/shared/api/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('@/shared/config/env', () => ({ isSupabaseConfigured: true }))
vi.mock('@/shared/lib/date', () => ({ getTodayDateInputValue: () => '2026-07-08' }))
vi.mock('@/shared/lib/offline-db', () => ({
  offlineDb: { local_reservations: { bulkPut: vi.fn() } },
}))

import { listTodayQueueAuthors, listTodayQueueRowsPage } from './index'

const allocationRow = {
  id: 'allocation-id', allocation_id: 'allocation-id', queue_entry_id: 'entry-id',
  permanent_number: 2847, queue_number: 2847, ticket_number: 2847,
  date: '2026-07-08', station_id: 'station-id', station_name: 'АЗС №1',
  vehicle_id: 'vehicle-id', driver_id: 'driver-id', operator_id: 'profile-id',
  fuel_type: 'AI_95', assigned_fuel_type: 'AI_92', preferred_fuel_type: 'AI_95',
  fuel_preference_mode: 'ANY_GASOLINE', requested_liters: 40,
  daily_position: 7, current_position: 7, people_ahead: 6,
  station_position: 3, station_fuel_position: 2,
  arrival_at: '2026-07-08T10:05:00.000Z', allocation_status: 'ACTIVE',
  status: 'WAITING', sync_status: 'SYNCED', comment: null, client_mutation_id: 'mutation-id',
  is_within_today_limit: true, is_callable_now: true, matched_fuel_type: 'AI_92',
  latest_call_status: 'NOT_CALLED', normalized_plate_number: 'А123ВС777',
  driver_full_name: 'Иван Иванов', driver_phone: '+79991234567',
  created_by_full_name: 'Оператор', created_by_role: 'cashier', updated_at: '2026-07-08T09:00:00Z',
}

describe('daily allocation queue API', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('loads saved positions and ETA without invoking a no-show policy', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        rows: [allocationRow], next_cursor: null,
        summary: {
          total_count: 1, callable_count: 1, contacted_count: 0, no_answer_count: 0,
          category_counts: { GASOLINE: 1, DIESEL: 0, GAS: 0 },
          callable_category_counts: { GASOLINE: 1, DIESEL: 0, GAS: 0 },
        },
      }, error: null,
    })

    const page = await listTodayQueueRowsPage({ fuelCategoryFilter: 'GASOLINE' })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('get_today_call_list', expect.objectContaining({
      target_date: '2026-07-08', fuel_category_filter: 'GASOLINE',
    }))
    expect(page.rows[0]).toMatchObject({
      allocation_id: 'allocation-id', queue_entry_id: 'entry-id', permanent_number: 2847,
      daily_position: 7, station_position: 3, station_fuel_position: 2,
      arrival_at: '2026-07-08T10:05:00.000Z', assigned_fuel_type: 'AI_92',
    })
    expect(page.summary.total_count).toBe(1)
  })

  it('loads city queue rows without a daily allocation as outside the limit', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        rows: [{
          ...allocationRow,
          id: 'entry-id',
          allocation_id: null,
          date: null,
          station_id: null,
          station_name: null,
          assigned_fuel_type: null,
          matched_fuel_type: null,
          daily_position: 2847,
          current_position: 2847,
          station_position: null,
          station_fuel_position: null,
          arrival_at: null,
          allocation_status: 'PAUSED_BY_LIMIT',
          is_within_today_limit: false,
          is_callable_now: false,
          call_unavailable_reason: 'OUTSIDE_TODAY_LIMIT',
          latest_call_status: null,
        }],
        next_cursor: null,
        summary: {
          total_count: 1, callable_count: 0, contacted_count: 0, no_answer_count: 0,
          category_counts: { GASOLINE: 1, DIESEL: 0, GAS: 0 },
          callable_category_counts: { GASOLINE: 0, DIESEL: 0, GAS: 0 },
        },
      },
      error: null,
    })

    const page = await listTodayQueueRowsPage()

    expect(page.rows[0]).toMatchObject({
      allocation_id: undefined,
      queue_entry_id: 'entry-id',
      permanent_number: 2847,
      daily_position: 2847,
      station_position: undefined,
      station_fuel_position: undefined,
      is_within_today_limit: false,
      is_callable_now: false,
      call_unavailable_reason: 'OUTSIDE_TODAY_LIMIT',
    })
    expect(page.summary.callable_count).toBe(0)
  })

  it('loads author filters from the server', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ user_id: 'profile-id', display_name: 'Оператор', role: 'cashier', signature_name: null }],
      error: null,
    })
    await expect(listTodayQueueAuthors()).resolves.toEqual([
      { userId: 'profile-id', displayName: 'Оператор', role: 'cashier', signatureName: null },
    ])
  })
})
