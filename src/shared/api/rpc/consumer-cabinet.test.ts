import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import {
  parseCancelMyReservationResult,
  parseConsumerReservation,
  parseConsumerVehicle,
} from './consumer-cabinet'

describe('consumer cabinet RPC parsers', () => {
  it('parses a consumer vehicle response', () => {
    expect(
      parseConsumerVehicle({
        id: 'vehicle-id',
        profile_vehicle_id: 'profile-vehicle-id',
        plate_number: 'A123BC777',
        normalized_plate_number: 'А123ВС777',
        is_blocked: false,
        block_reason: null,
        status: 'ACTIVE',
        created_at: '2026-07-09T10:00:00Z',
        updated_at: '2026-07-09T10:00:00Z',
      }),
    ).toEqual({
      id: 'vehicle-id',
      profile_vehicle_id: 'profile-vehicle-id',
      plate_number: 'A123BC777',
      normalized_plate_number: 'А123ВС777',
      is_blocked: false,
      block_reason: null,
      status: 'ACTIVE',
      created_at: '2026-07-09T10:00:00Z',
      updated_at: '2026-07-09T10:00:00Z',
    })
  })

  it('parses a consumer reservation response', () => {
    expect(
      parseConsumerReservation({
        id: 'reservation-id',
        date: null,
        station_id: null,
        vehicle_id: 'vehicle-id',
        driver_id: 'driver-id',
        normalized_plate_number: 'А123ВС777',
        driver_full_name: 'Иван Иванов',
        driver_phone: '+79991234567',
        fuel_type: 'AI_95',
        fuel_preference_mode: 'ANY_GASOLINE',
        requested_liters: '20.5',
        queue_number: '7',
        current_position: '3',
        people_ahead: '2',
        is_within_today_limit: true,
        is_callable_now: false,
        matched_fuel_type: 'AI_92',
        is_fuel_preference_update_locked: true,
        status: 'RESERVED',
        client_mutation_id: 'mutation-id',
      }),
    ).toMatchObject({
      id: 'reservation-id',
      vehicle_id: 'vehicle-id',
      queue_number: 7,
      ticket_number: 7,
      current_position: 3,
      people_ahead: 2,
      is_within_today_limit: true,
      is_callable_now: false,
      matched_fuel_type: 'AI_92',
      is_fuel_preference_update_locked: true,
      requested_liters: 20.5,
      status: 'RESERVED',
    })
  })

  it('parses a consumer cancel response', () => {
    expect(
      parseCancelMyReservationResult({
        id: 'reservation-id',
        date: null,
        station_id: null,
        vehicle_id: 'vehicle-id',
        queue_number: '7',
        status: 'CANCELLED',
        sync_status: 'SYNCED',
        cancelled_by: 'profile-id',
        cancelled_at: '2026-07-09T10:00:00Z',
        cancel_reason: 'OWNER_CANCELLED',
        cancel_comment: null,
        updated_at: '2026-07-09T10:00:00Z',
      }),
    ).toMatchObject({
      id: 'reservation-id',
      queue_number: 7,
      status: 'CANCELLED',
      sync_status: 'SYNCED',
      cancel_reason: 'OWNER_CANCELLED',
    })
  })
})
