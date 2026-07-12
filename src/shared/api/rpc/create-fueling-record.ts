import { isSupabaseConfigured } from '@/shared/config/env'
import type { FuelType, SyncStatus } from '@/shared/constants'

import type { RpcResult } from './index'
import { requestProtectedRpcApi } from './protected-api'

export type CreateFuelingRecordParams = {
  allocationId?: string
  preferentialQueueEntryId?: string
  stationId: string
  plateNumber: string
  liters: number
  fuelType?: FuelType
  targetDate: string
  fueledAt: string
  comment?: string
  clientMutationId: string
}

export type CreateFuelingRecordResult = {
  id: string
  date: string
  station_id: string
  vehicle_id: string
  driver_id: string | null
  reservation_id: string | null
  allocation_id: string | null
  queue_entry_id: string | null
  preferential_queue_entry_id: string | null
  fuel_type: FuelType
  liters: number
  is_manual_override: boolean
  override_id: string | null
  client_mutation_id: string
  sync_status: SyncStatus
  fueled_at: string
}

function toNumber(value: unknown) {
  return typeof value === 'number' ? value : Number(value)
}

export function parseCreateFuelingRecordResult(
  value: unknown,
): CreateFuelingRecordResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<CreateFuelingRecordResult>

  if (
    typeof result.id === 'string' &&
    typeof result.date === 'string' &&
    typeof result.station_id === 'string' &&
    typeof result.vehicle_id === 'string' &&
    typeof result.fuel_type === 'string' &&
    typeof result.is_manual_override === 'boolean' &&
    typeof result.client_mutation_id === 'string' &&
    typeof result.sync_status === 'string' &&
    typeof result.fueled_at === 'string'
  ) {
    return {
      id: result.id,
      date: result.date,
      station_id: result.station_id,
      vehicle_id: result.vehicle_id,
      driver_id: result.driver_id ?? null,
      reservation_id: result.reservation_id ?? null,
      allocation_id: result.allocation_id ?? null,
      queue_entry_id: result.queue_entry_id ?? null,
      preferential_queue_entry_id: result.preferential_queue_entry_id ?? null,
      fuel_type: result.fuel_type as FuelType,
      liters: toNumber(result.liters),
      is_manual_override: result.is_manual_override,
      override_id: result.override_id ?? null,
      client_mutation_id: result.client_mutation_id,
      sync_status: result.sync_status as SyncStatus,
      fueled_at: result.fueled_at,
    }
  }

  return null
}

export async function createFuelingRecord({
  allocationId,
  preferentialQueueEntryId,
  stationId,
  plateNumber,
  liters,
  fuelType,
  targetDate,
  fueledAt,
  comment,
  clientMutationId,
}: CreateFuelingRecordParams): Promise<RpcResult<CreateFuelingRecordResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Сервис фиксации заправки не настроен.',
    }
  }

  void stationId
  void plateNumber
  void fuelType
  void targetDate

  if (preferentialQueueEntryId) {
    try {
      const data = await requestProtectedRpcApi(
        '/api/create-fueling-record-for-preferential-entry',
        {
          preferentialQueueEntryId,
          stationId,
          liters,
          fueledAt,
          comment: comment ?? null,
          clientMutationId,
        },
        'Не удалось отправить запрос на фиксацию льготной заправки.',
      )
      const parsed = parseCreateFuelingRecordResult(data)

      if (!parsed) {
        return {
          data: null,
          error: 'Сервер вернул неожиданный ответ при фиксации заправки.',
        }
      }

      return {
        data: parsed,
        error: null,
      }
    } catch (error) {
      return {
        data: null,
        error:
          error instanceof Error
            ? error.message
            : 'Не удалось отправить запрос на фиксацию льготной заправки.',
      }
    }
  }

  if (!allocationId) {
    return {
      data: null,
      error: 'Для фиксации заправки нужно активное назначение на сегодня.',
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/create-fueling-record-for-allocation',
      {
        allocationId,
        liters,
        fueledAt,
        comment: comment ?? null,
        clientMutationId,
      },
      'Не удалось отправить запрос на фиксацию заправки.',
    )
    const parsed = parseCreateFuelingRecordResult(data)

    if (!parsed) {
      return {
        data: null,
        error: 'Сервер вернул неожиданный ответ при фиксации заправки.',
      }
    }

    return {
      data: parsed,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : 'Не удалось отправить запрос на фиксацию заправки.',
    }
  }
}
