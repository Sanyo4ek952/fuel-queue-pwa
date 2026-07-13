import { isSupabaseConfigured } from '@/shared/config/env'
import type { FuelPreferenceMode, FuelType } from '@/shared/constants'
import { normalizePlateNumber } from '@/shared/lib/plate-number'

import type { RpcResult } from './index'
import { requestProtectedRpcApi } from './protected-api'

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
  queue_entry_id: string
  permanent_number: number
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
  status: 'WAITING' | 'FUELED' | 'CANCELLED' | 'NO_SHOW' | 'ERROR' | 'CONFLICT'
  client_mutation_id: string
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

export function parseCreateReservationResult(value: unknown): CreateReservationResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<CreateReservationResult>
  const ticketNumber =
    toNullableNumber(result.permanent_number) ??
    toNullableNumber(result.ticket_number) ??
    toNumber(result.queue_number)

  if (
    typeof result.id === 'string' &&
    typeof result.vehicle_id === 'string' &&
    typeof result.fuel_type === 'string' &&
    typeof result.status === 'string' &&
    typeof result.client_mutation_id === 'string' &&
    Number.isFinite(ticketNumber)
  ) {
    return {
      id: result.id,
      queue_entry_id: result.queue_entry_id ?? result.id,
      permanent_number: ticketNumber,
      vehicle_id: result.vehicle_id,
      driver_id: result.driver_id ?? null,
      normalized_plate_number: result.normalized_plate_number ?? '',
      driver_full_name: result.driver_full_name ?? '',
      driver_phone: result.driver_phone ?? null,
      fuel_type: result.fuel_type as FuelType,
      fuel_preference_mode: (result.fuel_preference_mode ?? 'EXACT') as FuelPreferenceMode,
      requested_liters: toNumber(result.requested_liters),
      queue_number: ticketNumber,
      ticket_number: ticketNumber,
      current_position: toNullableNumber(result.current_position),
      people_ahead: toNullableNumber(result.people_ahead),
      status: result.status as CreateReservationResult['status'],
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

  try {
    const data = await requestProtectedRpcApi(
      '/api/create-reservation',
      {
        plateNumber: normalizePlateNumber(plateNumber),
        driverFullName,
        driverPhone: driverPhone ?? null,
        fuelType,
        fuelPreferenceMode: fuelPreferenceMode ?? 'EXACT',
        requestedLiters,
        comment: comment ?? null,
        clientMutationId,
      },
      'Create reservation request failed.',
    )
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
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Create reservation request failed.',
    }
  }
}
