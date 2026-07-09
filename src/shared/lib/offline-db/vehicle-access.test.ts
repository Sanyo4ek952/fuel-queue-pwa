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
        normalized_plate_number: 'А123ВС777',
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
        station_id: null,
        date: checkDate,
        status: 'OPEN',
        category_overviews: [
          {
            fuel_type: 'AI_95',
            fuel_category: 'GASOLINE',
            label: 'Бензин',
            limit_mode: 'vehicle_count',
            vehicle_limit: 10,
            liters_limit: null,
            queue_count: 1,
            queued_liters: 40,
            covered_vehicle_count: 1,
            covered_liters: 40,
            remaining_vehicle_count: 9,
            remaining_liters: null,
            projected_queue_number: 7,
          },
        ],
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
      plateNumber: 'А123ВС777',
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

  it('allows an any-gasoline reservation when AI-92 has exact limit room', () => {
    expect(
      check(
        makeSnapshot({
          reservations: [
            {
              id: 'reservation-1',
              station_id: stationId,
              vehicle_id: vehicleId,
              date: checkDate,
              status: 'RESERVED',
              queue_number: 7,
              fuel_type: 'AI_95',
              fuel_preference_mode: 'ANY_GASOLINE',
              requested_liters: 40,
            },
          ],
          dailyLimits: [
            {
              id: 'daily-limit-1',
              station_id: null,
              date: checkDate,
              status: 'OPEN',
              category_overviews: [
                {
                  fuel_type: 'AI_92',
                  fuel_category: 'GASOLINE',
                  label: 'РђР-92',
                  limit_mode: 'vehicle_count',
                  vehicle_limit: 1,
                  liters_limit: null,
                  queue_count: 1,
                  queued_liters: 40,
                  covered_vehicle_count: 0,
                  covered_liters: 0,
                  remaining_vehicle_count: 1,
                  remaining_liters: null,
                  projected_queue_number: null,
                },
              ],
            },
          ],
        }),
      ),
    ).toMatchObject({
      status: 'ALLOWED',
      reason: 'ACTIVE_RESERVATION',
      fuel_type: 'AI_95',
      fuel_preference_mode: 'ANY_GASOLINE',
      matched_fuel_type: 'AI_92',
    })
  })

  it('prefers the requested AI-95 limit before other gasoline limits', () => {
    expect(
      check(
        makeSnapshot({
          reservations: [
            {
              id: 'reservation-1',
              station_id: stationId,
              vehicle_id: vehicleId,
              date: checkDate,
              status: 'RESERVED',
              queue_number: 7,
              fuel_type: 'AI_95',
              fuel_preference_mode: 'ANY_GASOLINE',
              requested_liters: 40,
            },
          ],
          dailyLimits: [
            {
              id: 'daily-limit-1',
              station_id: null,
              date: checkDate,
              status: 'OPEN',
              category_overviews: [
                {
                  fuel_type: 'AI_92',
                  fuel_category: 'GASOLINE',
                  label: 'Р С’Р В-92',
                  limit_mode: 'vehicle_count',
                  vehicle_limit: 1,
                  liters_limit: null,
                  queue_count: 1,
                  queued_liters: 40,
                  covered_vehicle_count: 0,
                  covered_liters: 0,
                  remaining_vehicle_count: 1,
                  remaining_liters: null,
                  projected_queue_number: null,
                },
                {
                  fuel_type: 'AI_95',
                  fuel_category: 'GASOLINE',
                  label: 'Р С’Р В-95',
                  limit_mode: 'vehicle_count',
                  vehicle_limit: 1,
                  liters_limit: null,
                  queue_count: 1,
                  queued_liters: 40,
                  covered_vehicle_count: 0,
                  covered_liters: 0,
                  remaining_vehicle_count: 1,
                  remaining_liters: null,
                  projected_queue_number: null,
                },
              ],
            },
          ],
        }),
      ),
    ).toMatchObject({
      status: 'ALLOWED',
      reason: 'ACTIVE_RESERVATION',
      fuel_type: 'AI_95',
      fuel_preference_mode: 'ANY_GASOLINE',
      matched_fuel_type: 'AI_95',
    })
  })

  it('blocks an exact AI-95 reservation when only AI-92 has limit room', () => {
    expect(
      check(
        makeSnapshot({
          dailyLimits: [
            {
              id: 'daily-limit-1',
              station_id: null,
              date: checkDate,
              status: 'OPEN',
              category_overviews: [
                {
                  fuel_type: 'AI_92',
                  fuel_category: 'GASOLINE',
                  label: 'РђР-92',
                  limit_mode: 'vehicle_count',
                  vehicle_limit: 1,
                  liters_limit: null,
                  queue_count: 1,
                  queued_liters: 40,
                  covered_vehicle_count: 0,
                  covered_liters: 0,
                  remaining_vehicle_count: 1,
                  remaining_liters: null,
                  projected_queue_number: null,
                },
              ],
            },
          ],
        }),
      ),
    ).toMatchObject({
      status: 'BLOCKED',
      reason: 'OUTSIDE_TODAY_LIMIT',
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

  it('blocks when cached refuel cooldown is still active', () => {
    expect(
      check(
        makeSnapshot({
          cooldownDays: 2,
          fuelingRecords: [
            {
              id: 'fueling-1',
              station_id: otherStationId,
              vehicle_id: vehicleId,
              date: '2026-07-04',
              fueled_at: '2026-07-04T10:00:00.000Z',
              is_manual_override: false,
            },
          ],
        }),
      ),
    ).toMatchObject({
      status: 'BLOCKED',
      reason: 'REFUEL_COOLDOWN_ACTIVE',
      last_fueling_date: '2026-07-04',
      next_allowed_date: '2026-07-06',
      cooldown_days: 2,
      days_since_last_fueling: 1,
    })
  })

  it('blocks a blocked vehicle without a manual override', () => {
    expect(
      check(
        makeSnapshot({
          vehicles: [
            {
              id: vehicleId,
              normalized_plate_number: 'А123ВС777',
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

  it('blocks an active reservation without a daily limit', () => {
    expect(check(makeSnapshot({ dailyLimits: [] }))).toMatchObject({
      status: 'BLOCKED',
      reason: 'NO_GLOBAL_DAILY_LIMIT',
    })
  })

  it('blocks when the exact fuel vehicle limit is already exhausted', () => {
    expect(
      check(
        makeSnapshot({
          dailyLimits: [
            {
              id: 'daily-limit-1',
              station_id: null,
              date: checkDate,
              status: 'OPEN',
              category_overviews: [
                {
                  fuel_type: 'AI_95',
                  fuel_category: 'GASOLINE',
                  label: 'Бензин',
                  limit_mode: 'vehicle_count',
                  vehicle_limit: 0,
                  liters_limit: null,
                  queue_count: 1,
                  queued_liters: 40,
                  covered_vehicle_count: 0,
                  covered_liters: 0,
                  remaining_vehicle_count: 0,
                  remaining_liters: null,
                  projected_queue_number: null,
                },
              ],
            },
          ],
        }),
      ),
    ).toMatchObject({
      status: 'BLOCKED',
      reason: 'OUTSIDE_TODAY_LIMIT',
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
