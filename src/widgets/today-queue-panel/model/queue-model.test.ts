import { describe, expect, it } from 'vitest'

import type { TodayQueueRow } from '@/entities/reservation'

import {
  getCallFilterCounts,
  groupRowsByFuelCategory,
  hasActiveGasolineLimit,
  isRowCallable,
  matchesCallFilter,
  toFuelingScheduleRows,
} from './queue-model'

function makeQueueRow(overrides: Partial<TodayQueueRow> = {}): TodayQueueRow {
  return {
    id: 'reservation-id',
    date: null,
    station_id: null,
    vehicle_id: 'vehicle-id',
    driver_id: null,
    created_by_profile_id: 'profile-id',
    created_by_full_name: 'Мария Петрова',
    created_by_role: 'cashier',
    created_by_signature_name: 'Петрова М.',
    queue_number: 1,
    ticket_number: 1,
    current_position: 1,
    people_ahead: 0,
    normalized_plate_number: 'А123ВС777',
    driver_full_name: 'Иван Иванов',
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

describe('today queue model', () => {
  it('matches call filters by server callable flag and latest call status', () => {
    const callable = makeQueueRow({ latest_call_status: null, is_callable_now: true })
    const contacted = makeQueueRow({ latest_call_status: 'CONTACTED', is_callable_now: true })
    const noAnswer = makeQueueRow({ latest_call_status: 'NO_ANSWER', is_callable_now: true })
    const outsideLimit = makeQueueRow({ is_callable_now: false, is_within_today_limit: true })

    expect(isRowCallable(callable)).toBe(true)
    expect(matchesCallFilter(callable, 'call')).toBe(true)
    expect(matchesCallFilter(contacted, 'call')).toBe(false)
    expect(matchesCallFilter(contacted, 'contacted')).toBe(true)
    expect(matchesCallFilter(noAnswer, 'no_answer')).toBe(true)
    expect(matchesCallFilter(outsideLimit, 'call')).toBe(false)
  })

  it('counts call filter counters without including the all filter', () => {
    const rows = [
      makeQueueRow({ id: 'callable', latest_call_status: null, is_callable_now: true }),
      makeQueueRow({ id: 'contacted', latest_call_status: 'CONTACTED', is_callable_now: true }),
      makeQueueRow({ id: 'no-answer', latest_call_status: 'NO_ANSWER', is_callable_now: true }),
    ]

    expect(getCallFilterCounts(rows)).toEqual({
      call: 2,
      contacted: 1,
      no_answer: 1,
    })
  })

  it('groups rows by fuel queue category in stable tab order', () => {
    const groups = groupRowsByFuelCategory([
      makeQueueRow({ id: 'gas', fuel_type: 'GAS' }),
      makeQueueRow({ id: 'diesel', fuel_type: 'DIESEL' }),
      makeQueueRow({ id: 'gasoline', fuel_type: 'AI_92' }),
    ])

    expect(groups.map((group) => group.fuelCategory)).toEqual(['GASOLINE', 'DIESEL', 'GAS'])
    expect(groups.map((group) => group.rows.map((row) => row.id))).toEqual([
      ['gasoline'],
      ['diesel'],
      ['gas'],
    ])
  })

  it('locks gasoline fuel preference editing only for active gasoline limits', () => {
    expect(hasActiveGasolineLimit(undefined)).toBe(false)
    expect(
      hasActiveGasolineLimit([
        {
          fuel_category: 'GASOLINE',
          limit_mode: 'vehicle_count',
          vehicle_limit: 0,
          liters_limit: null,
        },
      ]),
    ).toBe(false)
    expect(
      hasActiveGasolineLimit([
        {
          fuel_category: 'GASOLINE',
          limit_mode: 'fuel_liters',
          vehicle_limit: 0,
          liters_limit: 100,
        },
      ]),
    ).toBe(true)
  })

  it('builds ETA input rows only for callable queue rows', () => {
    expect(
      toFuelingScheduleRows([
        makeQueueRow({ id: 'callable', ticket_number: 2, fuel_type: 'DIESEL' }),
        makeQueueRow({ id: 'outside', is_callable_now: false, fuel_type: 'AI_95' }),
      ]),
    ).toEqual([
      {
        id: 'callable',
        ticketNumber: 2,
        fuelCategory: 'DIESEL',
      },
    ])
  })
})
