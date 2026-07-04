import { describe, expect, it } from 'vitest'

import {
  evaluateVehicleAccessOffline,
  markOfflineResult,
  type OfflineVehicleAccessSnapshot,
} from './vehicle-access'

const stationId = '10000000-0000-0000-0000-000000000001'
const otherStationId = '10000000-0000-0000-0000-000000000002'
const checkDate = '2026-07-05'
const vehicleId = 'vehicle-1'

function makeSnapshot(
  overrides: Partial<OfflineVehicleAccessSnapshot> = {},
): OfflineVehicleAccessSnapshot {
  return {
    vehicles: [
      {
        id: vehicleId,
        normalized_plate_number: 'А123ВС',
        is_blocked: false,
      },
    ],
    reservations: [
      {
        id: 'reservation-1',
        station_id: stationId,
        vehicle_id: vehicleId,
        date: checkDate,
        status: 'RESERVED',
        queue_number: 7,
        fuel_type: 'AI_95',
        requested_liters: 40,
      },
    ],
    dailyLimits: [
      {
        id: 'daily-limit-1',
        station_id: stationId,
        date: checkDate,
        status: 'OPEN',
        max_liters_per_vehicle: 50,
      },
    ],
    fuelingRecords: [],
    manualOverrides: [],
    ...overrides,
  }
}

function check(snapshot: OfflineVehicleAccessSnapshot = makeSnapshot()) {
  return evaluateVehicleAccessOffline(
    {
      plateNumber: 'A123BC',
      stationId,
      checkDate,
    },
    snapshot,
  )
}

describe('evaluateVehicleAccessOffline', () => {
  it('allows an active reservation within the daily limit', () => {
    expect(check()).toMatchObject({
      status: 'ALLOWED',
      reason: 'ACTIVE_RESERVATION',
      queue_number: 7,
      fuel_type: 'AI_95',
      requested_liters: 40,
    })
  })

  it('blocks when there is no active reservation', () => {
    expect(check(makeSnapshot({ reservations: [] }))).toMatchObject({
      status: 'BLOCKED',
      reason: 'NO_ACTIVE_RESERVATION',
    })
  })

  it('blocks when the vehicle has already fueled today', () => {
    expect(
      check(
        makeSnapshot({
          fuelingRecords: [
            {
              id: 'fueling-1',
              station_id: otherStationId,
              vehicle_id: vehicleId,
              date: checkDate,
              fueled_at: '2026-07-05T10:00:00.000Z',
              is_manual_override: false,
            },
          ],
        }),
      ),
    ).toMatchObject({
      status: 'BLOCKED',
      reason: 'ALREADY_FUELED',
      last_fueling_station_id: otherStationId,
    })
  })

  it('blocks a blocked vehicle without a manual override', () => {
    expect(
      check(
        makeSnapshot({
          vehicles: [
            {
              id: vehicleId,
              normalized_plate_number: 'А123ВС',
              is_blocked: true,
              block_reason: 'test block',
            },
          ],
        }),
      ),
    ).toMatchObject({
      status: 'BLOCKED',
      reason: 'VEHICLE_BLOCKED',
      block_reason: 'test block',
    })
  })

  it('allows an active manual override without a reservation', () => {
    expect(
      check(
        makeSnapshot({
          reservations: [],
          manualOverrides: [
            {
              id: 'override-1',
              station_id: stationId,
              vehicle_id: vehicleId,
              date: checkDate,
              used_at: null,
              expires_at: '2999-01-01T00:00:00.000Z',
            },
          ],
        }),
      ),
    ).toMatchObject({
      status: 'ALLOWED',
      reason: 'MANUAL_OVERRIDE_ACTIVE',
      manual_override_id: 'override-1',
    })
  })

  it('blocks when there is no daily limit', () => {
    expect(check(makeSnapshot({ dailyLimits: [] }))).toMatchObject({
      status: 'BLOCKED',
      reason: 'NO_DAILY_LIMIT',
    })
  })

  it('blocks when requested liters exceed the daily per-vehicle limit', () => {
    expect(
      check(
        makeSnapshot({
          dailyLimits: [
            {
              id: 'daily-limit-1',
              station_id: stationId,
              date: checkDate,
              status: 'OPEN',
              max_liters_per_vehicle: 30,
            },
          ],
        }),
      ),
    ).toMatchObject({
      status: 'BLOCKED',
      reason: 'LITERS_LIMIT_EXCEEDED',
      requested_liters: 40,
      max_liters_per_vehicle: 30,
    })
  })

  it('marks offline results as warning and keeps the local decision', () => {
    expect(markOfflineResult(check())).toMatchObject({
      status: 'WARNING',
      reason: 'OFFLINE_UNCONFIRMED',
      offline: true,
      offline_decision: 'ALLOWED',
      offline_reason: 'ACTIVE_RESERVATION',
    })
  })
})
