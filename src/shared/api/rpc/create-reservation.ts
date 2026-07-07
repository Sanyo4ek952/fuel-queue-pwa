import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import type { FuelPreferenceMode, FuelType, ReservationStatus } from '@/shared/constants'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import type { RpcResult } from './index'

export type CreateReservationParams = {
  plateNumber: string
  driverFullName: string
  driverPhone?: string
  fuelType: FuelType
  fuelPreferenceMode?: FuelPreferenceMode
  requestedLiters: number
  comment?: string
  clientMutationId: string
}

export type CreateReservationResult = {
  id: string
  date: string | null
  station_id: string | null
  vehicle_id: string
  driver_id: string | null
  normalized_plate_number: string
  driver_full_name: string
  driver_phone: string | null
  fuel_type: FuelType
  fuel_preference_mode: FuelPreferenceMode
  requested_liters: number
  queue_number: number
  status: ReservationStatus
  client_mutation_id: string
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

export function parseCreateReservationResult(value: unknown): CreateReservationResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<CreateReservationResult>

  if (
    typeof result.id === 'string' &&
    typeof result.vehicle_id === 'string' &&
    typeof result.fuel_type === 'string' &&
    typeof result.status === 'string' &&
    typeof result.client_mutation_id === 'string'
  ) {
    return {
      id: result.id,
      date: result.date ?? null,
      station_id: result.station_id ?? null,
      vehicle_id: result.vehicle_id,
      driver_id: result.driver_id ?? null,
      normalized_plate_number: result.normalized_plate_number ?? '',
      driver_full_name: result.driver_full_name ?? '',
      driver_phone: result.driver_phone ?? null,
      fuel_type: result.fuel_type as FuelType,
      fuel_preference_mode: (result.fuel_preference_mode ?? 'EXACT') as FuelPreferenceMode,
      requested_liters: toNumber(result.requested_liters),
      queue_number: toNumber(result.queue_number),
      status: result.status as ReservationStatus,
      client_mutation_id: result.client_mutation_id,
    }
  }

  return null
}

export async function createReservation({
  plateNumber,
  driverFullName,
  driverPhone,
  fuelType,
  fuelPreferenceMode,
  requestedLiters,
  comment,
  clientMutationId,
}: CreateReservationParams): Promise<RpcResult<CreateReservationResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('create_reservation', {
    plate_number: normalizePlateNumber(plateNumber),
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

  const parsed = parseCreateReservationResult(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected create_reservation response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
