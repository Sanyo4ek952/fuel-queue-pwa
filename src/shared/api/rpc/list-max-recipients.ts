import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'

import type { RpcResult } from './index'

export type MaxRecipientStatus = 'linked' | 'no_consent' | 'unlinked'

export type MaxRecipient = {
  normalized_phone: string
  display_phone: string
  display_name: string
  driver_ids: string[]
  driver_count: number
  max_status: MaxRecipientStatus
  is_linked: boolean
  consent_status: 'granted' | 'revoked' | null
  linked_at: string | null
}

function parseRecipient(value: unknown): MaxRecipient | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<MaxRecipient>

  if (
    typeof row.normalized_phone === 'string' &&
    typeof row.display_phone === 'string' &&
    typeof row.display_name === 'string'
  ) {
    return {
      normalized_phone: row.normalized_phone,
      display_phone: row.display_phone,
      display_name: row.display_name,
      driver_ids: Array.isArray(row.driver_ids)
        ? row.driver_ids.filter((id): id is string => typeof id === 'string')
        : [],
      driver_count: Number(row.driver_count ?? 0),
      max_status:
        row.max_status === 'linked' || row.max_status === 'no_consent'
          ? row.max_status
          : 'unlinked',
      is_linked: Boolean(row.is_linked),
      consent_status: row.consent_status === 'granted' || row.consent_status === 'revoked'
        ? row.consent_status
        : null,
      linked_at: typeof row.linked_at === 'string' ? row.linked_at : null,
    }
  }

  return null
}

export function parseMaxRecipients(value: unknown): MaxRecipient[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map(parseRecipient).filter((row): row is MaxRecipient => Boolean(row))
}

export async function listMaxRecipients(): Promise<RpcResult<MaxRecipient[]>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('list_max_recipients')

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  return {
    data: parseMaxRecipients(data),
    error: null,
  }
}
