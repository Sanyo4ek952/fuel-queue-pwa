import { describe, expect, it } from 'vitest'

import { evaluateVehicleAccessOffline, markOfflineResult, type OfflineVehicleAccessSnapshot } from './vehicle-access'

const stationId = '10000000-0000-0000-0000-000000000001'
const checkDate = '2026-07-05'

function snapshot(allocationStatus: 'ACTIVE' | 'PAUSED_BY_LIMIT' = 'ACTIVE'): OfflineVehicleAccessSnapshot {
  return {
    vehicles: [{ id: 'vehicle-id', normalized_plate_number: 'А123ВС777', is_blocked: false }],
    reservations: [{
      id: 'allocation-id', allocation_id: 'allocation-id', queue_entry_id: 'entry-id',
      permanent_number: 77, station_id: stationId, vehicle_id: 'vehicle-id', date: checkDate,
      status: 'WAITING', queue_number: 77, fuel_type: 'AI_95', assigned_fuel_type: 'AI_92',
      allocation_status: allocationStatus, requested_liters: 40, station_fuel_position: 3,
      arrival_at: '2026-07-05T10:10:00.000Z',
    }],
    dailyLimits: [], fuelingRecords: [], manualOverrides: [],
  }
}

function check(value = snapshot()) {
  return evaluateVehicleAccessOffline(
    { plateNumber: 'А123ВС777', stationId, checkDate },
    value,
  )
}

describe('evaluateVehicleAccessOffline', () => {
  it('allows only a cached active server allocation', () => {
    expect(check()).toMatchObject({
      status: 'ALLOWED', allocation_id: 'allocation-id', queue_entry_id: 'entry-id',
      matched_fuel_type: 'AI_92', category_position: 3,
      arrival_at: '2026-07-05T10:10:00.000Z',
    })
  })

  it('blocks a server-paused allocation without recalculating limits', () => {
    expect(check(snapshot('PAUSED_BY_LIMIT'))).toMatchObject({
      status: 'BLOCKED', reason: 'OUTSIDE_TODAY_LIMIT', is_within_today_limit: false,
    })
  })

  it('blocks an allocation for another station', () => {
    const value = snapshot()
    value.reservations[0].station_id = '10000000-0000-0000-0000-000000000002'
    expect(check(value)).toMatchObject({ status: 'BLOCKED', reason: 'RESERVATION_AT_OTHER_STATION' })
  })

  it('keeps the cached decision explicitly unconfirmed offline', () => {
    expect(markOfflineResult(check())).toMatchObject({
      status: 'WARNING', reason: 'OFFLINE_UNCONFIRMED', offline_decision: 'ALLOWED',
    })
  })
})
