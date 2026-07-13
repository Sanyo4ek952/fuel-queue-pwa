import { isSupabaseConfigured } from '@/shared/config/env'
import {
  cacheResidentFuelNormLiters,
  getCachedResidentFuelNormLiters,
} from '@/shared/lib/offline-db'

import type { RpcResult } from './index'
import { requestProtectedRpcApi } from './protected-api'

export type ResidentFuelNormSetting = {
  liters: number
  updated_at?: string | null
  client_mutation_id?: string | null
}

export type SetResidentFuelNormParams = {
  liters: number
  clientMutationId: string
}

function toPositiveNumber(value: unknown, fallback = 20) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback
}

export function parseResidentFuelNormResult(value: unknown): ResidentFuelNormSetting | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<ResidentFuelNormSetting>

  if (typeof result.liters !== 'number' && typeof result.liters !== 'string') {
    return null
  }

  return {
    liters: toPositiveNumber(result.liters),
    updated_at: result.updated_at ?? null,
    client_mutation_id: result.client_mutation_id ?? null,
  }
}

export async function getResidentFuelNorm(): Promise<RpcResult<ResidentFuelNormSetting>> {
  if (!isSupabaseConfigured) {
    const cachedLiters = await getCachedResidentFuelNormLiters()

    return {
      data: { liters: cachedLiters },
      error: null,
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/resident-fuel-norm',
      {},
      'Resident fuel norm request failed.',
    )

    const setting = {
      liters: toPositiveNumber(data),
      updated_at: null,
      client_mutation_id: null,
    }

    await cacheResidentFuelNormLiters(setting.liters)

    return {
      data: setting,
      error: null,
    }
  } catch {
    const cachedLiters = await getCachedResidentFuelNormLiters()

    return {
      data: { liters: cachedLiters },
      error: null,
    }
  }
}

export async function setResidentFuelNorm({
  liters,
  clientMutationId,
}: SetResidentFuelNormParams): Promise<RpcResult<ResidentFuelNormSetting>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/set-resident-fuel-norm',
      { liters, clientMutationId },
      'Set resident fuel norm request failed.',
    )
    const parsed = parseResidentFuelNormResult(data)

    if (!parsed) {
      return {
        data: null,
        error: 'Unexpected set_resident_fuel_norm_liters response.',
      }
    }

    await cacheResidentFuelNormLiters(parsed.liters)

    return {
      data: parsed,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Set resident fuel norm request failed.',
    }
  }
}
