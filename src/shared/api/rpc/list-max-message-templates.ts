import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'

import type { RpcResult } from './index'

export type MaxMessageTemplate = {
  id: string
  title: string
  body: string
}

function parseTemplate(value: unknown): MaxMessageTemplate | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<MaxMessageTemplate>

  if (typeof row.id === 'string' && typeof row.title === 'string' && typeof row.body === 'string') {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
    }
  }

  return null
}

export function parseMaxMessageTemplates(value: unknown): MaxMessageTemplate[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map(parseTemplate).filter((row): row is MaxMessageTemplate => Boolean(row))
}

export async function listMaxMessageTemplates(): Promise<RpcResult<MaxMessageTemplate[]>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('list_max_message_templates')

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  return {
    data: parseMaxMessageTemplates(data),
    error: null,
  }
}
