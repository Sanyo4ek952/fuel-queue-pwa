import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import { cacheRefuelCooldownSetting } from '@/shared/lib/offline-db'

import type { RpcResult } from './index'

export type RefuelCooldownSetting = {
  days: number
  updated_at?: string | null
  client_mutation_id?: string | null
}

export type SetRefuelCooldownParams = {
  days: number
  clientMutationId: string
}

function toInteger(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : 0
}

function parseSetRefuelCooldownResult(value: unknown): RefuelCooldownSetting | null {
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

export async function getRefuelCooldown(): Promise<RpcResult<RefuelCooldownSetting>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('get_reservation_refuel_cooldown')

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

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

  const { data, error } = await supabase.rpc('set_reservation_refuel_cooldown', {
    days,
    client_mutation_id: clientMutationId,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseSetRefuelCooldownResult(data)

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
}
