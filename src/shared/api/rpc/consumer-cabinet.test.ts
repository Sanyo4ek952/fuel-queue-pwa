import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/api/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

vi.mock('@/shared/config/env', () => ({
  isSupabaseConfigured: true,
}))

import { supabase } from '@/shared/api/supabase'

import {
  createConsumerReservation,
  getMyTodayFuelingStatus,
  parseCancelMyReservationResult,
  parseConsumerReservation,
  parseConsumerTodayFuelingStatus,
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

  it('parses permanent number as the consumer common queue number', () => {
    expect(
      parseConsumerReservation({
        id: 'reservation-id',
        date: null,
        station_id: 'station-id',
        station_name: 'АЗС №1',
        station_address: 'Адрес 1',
        vehicle_id: 'vehicle-id',
        driver_id: 'driver-id',
        normalized_plate_number: 'А123ВС777',
        driver_full_name: 'Иван Иванов',
        driver_phone: '+79991234567',
        fuel_type: 'DIESEL',
        fuel_preference_mode: 'EXACT',
        requested_liters: '20.5',
        permanent_number: '10',
        queue_number: '10',
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
      station_name: 'АЗС №1',
      station_address: 'Адрес 1',
      fuel_type: 'DIESEL',
      permanent_number: 10,
      queue_number: 10,
      ticket_number: 10,
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

  it('keeps computed station context when reservation station id is still empty', () => {
    expect(
      parseConsumerReservation({
        id: 'reservation-id',
        date: '2026-07-10',
        station_id: null,
        station_name: 'АЗС №2',
        station_address: 'Адрес 2',
        vehicle_id: 'vehicle-id',
        fuel_type: 'AI_95',
        fuel_preference_mode: 'EXACT',
        requested_liters: 20,
        permanent_number: 8,
        queue_number: 8,
        is_within_today_limit: true,
        status: 'RESERVED',
        client_mutation_id: 'mutation-id',
      }),
    ).toMatchObject({
      permanent_number: 8,
      station_id: null,
      station_name: 'АЗС №2',
      station_address: 'Адрес 2',
      is_within_today_limit: true,
      ticket_number: 8,
    })
  })

  it('parses a waiting queue entry before daily allocation exists', () => {
    expect(
      parseConsumerReservation({
        id: 'queue-entry-id',
        queue_entry_id: 'queue-entry-id',
        permanent_number: 11,
        queue_number: 11,
        vehicle_id: 'vehicle-id',
        normalized_plate_number: 'А777АА777',
        fuel_type: 'AI_95',
        fuel_preference_mode: 'EXACT',
        requested_liters: 20,
        status: 'WAITING',
        client_mutation_id: 'mutation-id',
        allocation: null,
      }),
    ).toMatchObject({
      id: 'queue-entry-id',
      permanent_number: 11,
      normalized_plate_number: 'А777АА777',
      station_id: null,
      is_within_today_limit: null,
      status: 'WAITING',
      allocation: null,
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

  it('parses a consumer today fueling status response', () => {
    expect(
      parseConsumerTodayFuelingStatus({
        id: 'fueling-id',
        date: '2026-07-10',
        station_id: 'station-id',
        station_name: 'АЗС №1',
        station_address: 'Адрес 1',
        vehicle_id: 'vehicle-id',
        reservation_id: 'reservation-id',
        normalized_plate_number: 'А123ВС777',
        fuel_type: 'AI_95',
        liters: '20.5',
        fueled_at: '2026-07-10T10:00:00Z',
        ticket_number: '7',
      }),
    ).toEqual({
      id: 'fueling-id',
      date: '2026-07-10',
      station_id: 'station-id',
      station_name: 'АЗС №1',
      station_address: 'Адрес 1',
      vehicle_id: 'vehicle-id',
      reservation_id: 'reservation-id',
      normalized_plate_number: 'А123ВС777',
      fuel_type: 'AI_95',
      liters: 20.5,
      fueled_at: '2026-07-10T10:00:00Z',
      ticket_number: 7,
    })
  })

  it('returns null for an empty today fueling parser payload', () => {
    expect(parseConsumerTodayFuelingStatus(null)).toBeNull()
  })
})

describe('getMyTodayFuelingStatus', () => {
  it('returns null when the RPC has no today fueling record', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: null,
      error: null,
    } as never)

    await expect(getMyTodayFuelingStatus()).resolves.toBeNull()

    expect(supabase.rpc).toHaveBeenCalledWith('get_my_today_fueling_status')
  })

  it('returns a parsed today fueling record', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        id: 'fueling-id',
        date: '2026-07-10',
        station_id: 'station-id',
        station_name: 'АЗС №1',
        station_address: 'Адрес 1',
        vehicle_id: 'vehicle-id',
        reservation_id: 'reservation-id',
        normalized_plate_number: 'А123ВС777',
        fuel_type: 'AI_95',
        liters: '20.5',
        fueled_at: '2026-07-10T10:00:00Z',
        ticket_number: '7',
      },
      error: null,
    } as never)

    await expect(getMyTodayFuelingStatus()).resolves.toMatchObject({
      id: 'fueling-id',
      vehicle_id: 'vehicle-id',
      ticket_number: 7,
    })
  })
})

describe('createConsumerReservation', () => {
  it('keeps requested liters out of the public params and sends only a compatibility placeholder', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: {
        id: 'reservation-id',
        vehicle_id: 'vehicle-id',
        fuel_type: 'AI_95',
        fuel_preference_mode: 'EXACT',
        requested_liters: 25,
        permanent_number: 7,
        queue_number: 7,
        status: 'WAITING',
        client_mutation_id: 'mutation-id',
      },
      error: null,
    } as never)

    await expect(
      createConsumerReservation({
        vehicleId: 'vehicle-id',
        driverFullName: 'Иван Иванов',
        driverPhone: '+79991234567',
        fuelType: 'AI_95',
        fuelPreferenceMode: 'EXACT',
        comment: '',
        clientMutationId: 'mutation-id',
      }),
    ).resolves.toMatchObject({
      data: {
        requested_liters: 25,
      },
      error: null,
    })

    expect(supabase.rpc).toHaveBeenCalledWith('create_consumer_reservation', {
      vehicle_id: 'vehicle-id',
      driver_full_name: 'Иван Иванов',
      driver_phone: '+79991234567',
      fuel_type: 'AI_95',
      fuel_preference_mode: 'EXACT',
      requested_liters: 20,
      comment: '',
      client_mutation_id: 'mutation-id',
    })
  })
})
