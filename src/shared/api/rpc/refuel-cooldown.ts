import { isSupabaseConfigured } from '@/shared/config/env'
import { cacheNoShowGraceSetting, cacheRefuelCooldownSetting } from '@/shared/lib/offline-db'

import type { RpcResult } from './index'
import { requestProtectedRpcApi } from './protected-api'

export type RefuelCooldownSetting = {
  days: number
  updated_at?: string | null
  client_mutation_id?: string | null
}

export type SetRefuelCooldownParams = {
  days: number
  clientMutationId: string
}

export type NoShowGraceSetting = RefuelCooldownSetting
export type SetNoShowGraceParams = SetRefuelCooldownParams

function toInteger(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : 0
}

function parseDaysSettingResult(value: unknown): RefuelCooldownSetting | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<RefuelCooldownSetting>

  if (typeof result.days !== 'number' && typeof result.days !== 'string') {
    return null
  }

  return {
    days: toInteger(result.days),
    updated_at: result.updated_at ?? null,
    client_mutation_id: result.client_mutation_id ?? null,
  }
}

export const parseSetRefuelCooldownResult = parseDaysSettingResult

export async function getRefuelCooldown(): Promise<RpcResult<RefuelCooldownSetting>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/get-refuel-cooldown',
      {},
      'Refuel cooldown request failed.',
    )
    const setting = {
      days: toInteger(data),
      updated_at: null,
      client_mutation_id: null,
    }

    await cacheRefuelCooldownSetting(setting.days)

    return {
      data: setting,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Refuel cooldown request failed.',
    }
  }
}

export async function setRefuelCooldown({
  days,
  clientMutationId,
}: SetRefuelCooldownParams): Promise<RpcResult<RefuelCooldownSetting>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/set-refuel-cooldown',
      { days, clientMutationId },
      'Set refuel cooldown request failed.',
    )
    const parsed = parseDaysSettingResult(data)

    if (!parsed) {
      return {
        data: null,
        error: 'Unexpected set_reservation_refuel_cooldown response.',
      }
    }

    await cacheRefuelCooldownSetting(parsed.days)

    return {
      data: parsed,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Set refuel cooldown request failed.',
    }
  }
}

export async function getNoShowGrace(): Promise<RpcResult<NoShowGraceSetting>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/get-no-show-grace',
      {},
      'No-show grace request failed.',
    )
    const setting = {
      days: toInteger(data),
      updated_at: null,
      client_mutation_id: null,
    }

    await cacheNoShowGraceSetting(setting.days)

    return {
      data: setting,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'No-show grace request failed.',
    }
  }
}

export async function setNoShowGrace({
  days,
  clientMutationId,
}: SetNoShowGraceParams): Promise<RpcResult<NoShowGraceSetting>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/set-no-show-grace',
      { days, clientMutationId },
      'Set no-show grace request failed.',
    )
    const parsed = parseDaysSettingResult(data)

    if (!parsed) {
      return {
        data: null,
        error: 'Unexpected set_reservation_no_show_grace_days response.',
      }
    }

    await cacheNoShowGraceSetting(parsed.days)

    return {
      data: parsed,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Set no-show grace request failed.',
    }
  }
}
