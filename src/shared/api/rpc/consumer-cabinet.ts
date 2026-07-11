import { isSupabaseConfigured } from '@/shared/config/env'
import type {
  DailyQueueAllocationStatus,
  FuelPreferenceMode,
  FuelType,
  ReservationCallStatus,
  ReservationStatus,
  SyncStatus,
} from '@/shared/constants'
import { supabase } from '@/shared/api/supabase'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import type { RpcResult } from './index'

export type ConsumerVehicle = {
  id: string
  profile_vehicle_id: string
  plate_number: string
  normalized_plate_number: string
  is_blocked: boolean
  block_reason: string | null
  status: 'ACTIVE' | 'BLOCKED'
  created_at: string
  updated_at: string
}

export type CreateConsumerVehicleParams = {
  plateNumber: string
  clientMutationId: string
}

export type ConsumerReservation = {
  id: string
  queue_entry_id: string
  permanent_number: number
  date: string | null
  station_id: string | null
  station_name: string | null
  station_address: string | null
  vehicle_id: string
  driver_id: string | null
  normalized_plate_number: string
  driver_full_name: string
  driver_phone: string | null
  fuel_type: FuelType
  fuel_preference_mode: FuelPreferenceMode
  requested_liters: number
  queue_number: number
  ticket_number: number
  current_position: number | null
  people_ahead: number | null
  is_within_today_limit: boolean | null
  is_callable_now: boolean | null
  matched_fuel_type: FuelType | null
  is_fuel_preference_update_locked: boolean
  status: ReservationStatus
  client_mutation_id: string
  created_at?: string
  updated_at?: string
  allocation: ConsumerDailyQueueAllocation | null
}

export type ConsumerDailyQueueAllocation = {
  id: string
  date: string
  station_id: string
  station_name: string | null
  station_address: string | null
  assigned_fuel_type: FuelType
  daily_position: number
  station_position: number
  station_fuel_position: number
  arrival_at: string
  status: DailyQueueAllocationStatus
  call_status: ReservationCallStatus
}

export type ConsumerTodayFuelingStatus = {
  id: string
  date: string
  station_id: string
  station_name: string | null
  station_address: string | null
  vehicle_id: string
  reservation_id: string | null
  normalized_plate_number: string
  fuel_type: FuelType
  liters: number
  fueled_at: string
  ticket_number: number | null
}

export type CreateConsumerReservationParams = {
  vehicleId: string
  driverFullName: string
  driverPhone?: string
  fuelType: FuelType
  fuelPreferenceMode?: FuelPreferenceMode
  requestedLiters: number
  comment?: string
  clientMutationId: string
}

export type CancelMyReservationParams = {
  reservationId: string
  clientMutationId: string
}

export type CancelMyReservationResult = {
  id: string
  date: string | null
  station_id: string | null
  vehicle_id: string
  queue_number: number
  status: ReservationStatus
  sync_status: SyncStatus
  cancelled_by: string
  cancelled_at: string
  cancel_reason: string
  cancel_comment: string | null
  updated_at: string
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  const numericValue = toNumber(value)

  return Number.isFinite(numericValue) ? numericValue : null
}

function toNullableBoolean(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'boolean') {
    return value
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  return null
}

export function parseConsumerVehicle(value: unknown): ConsumerVehicle | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<ConsumerVehicle>

  if (
    typeof row.id === 'string' &&
    typeof row.profile_vehicle_id === 'string' &&
    typeof row.plate_number === 'string' &&
    typeof row.normalized_plate_number === 'string' &&
    typeof row.is_blocked === 'boolean' &&
    typeof row.status === 'string' &&
    typeof row.created_at === 'string' &&
    typeof row.updated_at === 'string'
  ) {
    return {
      id: row.id,
      profile_vehicle_id: row.profile_vehicle_id,
      plate_number: row.plate_number,
      normalized_plate_number: row.normalized_plate_number,
      is_blocked: row.is_blocked,
      block_reason: row.block_reason ?? null,
      status: row.status as ConsumerVehicle['status'],
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  return null
}

export function parseConsumerReservation(value: unknown): ConsumerReservation | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<ConsumerReservation>
  const ticketNumber = toNullableNumber(row.ticket_number) ?? toNumber(row.queue_number)
  const allocationValue = row.allocation
  const allocation =
    allocationValue && typeof allocationValue === 'object'
      ? (allocationValue as Partial<ConsumerDailyQueueAllocation>)
      : null

  if (
    typeof row.id === 'string' &&
    typeof row.vehicle_id === 'string' &&
    typeof row.fuel_type === 'string' &&
    typeof row.status === 'string' &&
    typeof row.client_mutation_id === 'string' &&
    Number.isFinite(ticketNumber)
  ) {
    return {
      id: row.id,
      queue_entry_id: row.queue_entry_id ?? row.id,
      permanent_number: toNullableNumber(row.permanent_number) ?? ticketNumber,
      date: row.date ?? null,
      station_id: row.station_id ?? null,
      station_name: row.station_name ?? null,
      station_address: row.station_address ?? null,
      vehicle_id: row.vehicle_id,
      driver_id: row.driver_id ?? null,
      normalized_plate_number: row.normalized_plate_number ?? '',
      driver_full_name: row.driver_full_name ?? '',
      driver_phone: row.driver_phone ?? null,
      fuel_type: row.fuel_type as FuelType,
      fuel_preference_mode: (row.fuel_preference_mode ?? 'EXACT') as FuelPreferenceMode,
      requested_liters: toNumber(row.requested_liters),
      queue_number: ticketNumber,
      ticket_number: ticketNumber,
      current_position: toNullableNumber(row.current_position),
      people_ahead: toNullableNumber(row.people_ahead),
      is_within_today_limit: toNullableBoolean(row.is_within_today_limit),
      is_callable_now: toNullableBoolean(row.is_callable_now),
      matched_fuel_type: (row.matched_fuel_type as FuelType | null | undefined) ?? null,
      is_fuel_preference_update_locked: row.is_fuel_preference_update_locked === true,
      status: row.status as ReservationStatus,
      client_mutation_id: row.client_mutation_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      allocation:
        allocation &&
        typeof allocation.id === 'string' &&
        typeof allocation.date === 'string' &&
        typeof allocation.station_id === 'string' &&
        typeof allocation.assigned_fuel_type === 'string' &&
        typeof allocation.arrival_at === 'string'
          ? {
              id: allocation.id,
              date: allocation.date,
              station_id: allocation.station_id,
              station_name: allocation.station_name ?? null,
              station_address: allocation.station_address ?? null,
              assigned_fuel_type: allocation.assigned_fuel_type as FuelType,
              daily_position: toNumber(allocation.daily_position),
              station_position: toNumber(allocation.station_position),
              station_fuel_position: toNumber(allocation.station_fuel_position),
              arrival_at: allocation.arrival_at,
              status: allocation.status as DailyQueueAllocationStatus,
              call_status: allocation.call_status as ReservationCallStatus,
            }
          : null,
    }
  }

  return null
}

export function parseConsumerTodayFuelingStatus(
  value: unknown,
): ConsumerTodayFuelingStatus | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<ConsumerTodayFuelingStatus>

  if (
    typeof row.id === 'string' &&
    typeof row.date === 'string' &&
    typeof row.station_id === 'string' &&
    typeof row.vehicle_id === 'string' &&
    typeof row.fuel_type === 'string' &&
    typeof row.fueled_at === 'string'
  ) {
    return {
      id: row.id,
      date: row.date,
      station_id: row.station_id,
      station_name: row.station_name ?? null,
      station_address: row.station_address ?? null,
      vehicle_id: row.vehicle_id,
      reservation_id: row.reservation_id ?? null,
      normalized_plate_number: row.normalized_plate_number ?? '',
      fuel_type: row.fuel_type as FuelType,
      liters: toNumber(row.liters),
      fueled_at: row.fueled_at,
      ticket_number: toNullableNumber(row.ticket_number),
    }
  }

  return null
}

export function parseCancelMyReservationResult(value: unknown): CancelMyReservationResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<CancelMyReservationResult>

  if (
    typeof row.id === 'string' &&
    typeof row.vehicle_id === 'string' &&
    row.queue_number != null &&
    typeof row.status === 'string' &&
    typeof row.sync_status === 'string' &&
    typeof row.cancelled_by === 'string' &&
    typeof row.cancelled_at === 'string' &&
    typeof row.cancel_reason === 'string' &&
    typeof row.updated_at === 'string'
  ) {
    return {
      id: row.id,
      date: row.date ?? null,
      station_id: row.station_id ?? null,
      vehicle_id: row.vehicle_id,
      queue_number: toNumber(row.queue_number),
      status: row.status as ReservationStatus,
      sync_status: row.sync_status as SyncStatus,
      cancelled_by: row.cancelled_by,
      cancelled_at: row.cancelled_at,
      cancel_reason: row.cancel_reason,
      cancel_comment: row.cancel_comment ?? null,
      updated_at: row.updated_at,
    }
  }

  return null
}

export async function listMyVehicles(): Promise<ConsumerVehicle[]> {
  if (!isSupabaseConfigured) {
    return []
  }

  const { data, error } = await supabase.rpc('list_my_vehicles')

  if (error) {
    throw new Error(error.message)
  }

  if (!Array.isArray(data)) {
    throw new Error('Unexpected list_my_vehicles response.')
  }

  return data.map(parseConsumerVehicle).filter((vehicle): vehicle is ConsumerVehicle => Boolean(vehicle))
}

export async function createConsumerVehicle({
  plateNumber,
  clientMutationId,
}: CreateConsumerVehicleParams): Promise<RpcResult<ConsumerVehicle>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('create_consumer_vehicle', {
    plate_number: normalizePlateNumber(plateNumber),
    client_mutation_id: clientMutationId,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseConsumerVehicle(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected create_consumer_vehicle response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}

export async function getMyQueueStatus(): Promise<ConsumerReservation | null> {
  if (!isSupabaseConfigured) {
    return null
  }

  const { data, error } = await supabase.rpc('get_my_queue_status')

  if (error) {
    throw new Error(error.message)
  }

  if (data === null) {
    return null
  }

  const parsed = parseConsumerReservation(data)

  if (!parsed) {
    throw new Error('Unexpected get_my_queue_status response.')
  }

  return parsed
}

export async function getMyTodayFuelingStatus(): Promise<ConsumerTodayFuelingStatus | null> {
  if (!isSupabaseConfigured) {
    return null
  }

  const { data, error } = await supabase.rpc('get_my_today_fueling_status')

  if (error) {
    throw new Error(error.message)
  }

  if (data === null) {
    return null
  }

  const parsed = parseConsumerTodayFuelingStatus(data)

  if (!parsed) {
    throw new Error('Unexpected get_my_today_fueling_status response.')
  }

  return parsed
}

export async function createConsumerReservation({
  vehicleId,
  driverFullName,
  driverPhone,
  fuelType,
  fuelPreferenceMode,
  requestedLiters,
  comment,
  clientMutationId,
}: CreateConsumerReservationParams): Promise<RpcResult<ConsumerReservation>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('create_consumer_reservation', {
    vehicle_id: vehicleId,
    driver_full_name: driverFullName,
    driver_phone: driverPhone ?? null,
    fuel_type: fuelType,
    fuel_preference_mode: fuelPreferenceMode ?? 'EXACT',
    requested_liters: requestedLiters,
    comment: comment ?? null,
    client_mutation_id: clientMutationId,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseConsumerReservation(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected create_consumer_reservation response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}

export async function cancelMyReservation({
  reservationId,
  clientMutationId,
}: CancelMyReservationParams): Promise<RpcResult<CancelMyReservationResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('cancel_my_reservation', {
    reservation_id: reservationId,
    client_mutation_id: clientMutationId,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseCancelMyReservationResult(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected cancel_my_reservation response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
