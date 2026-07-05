import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'

export type SendMaxMessageParams = {
  recipientPhones: string[]
  templateId?: string | null
  messageText: string
}

export type SendMaxMessageRecipientResult = {
  normalized_phone: string
  status: 'sent' | 'failed' | 'skipped'
  max_message_id: string | null
  error_message: string | null
}

export type SendMaxMessageResult = {
  batch_id: string
  status: 'sent' | 'partial' | 'failed'
  results: SendMaxMessageRecipientResult[]
}

function parseRecipientResult(value: unknown): SendMaxMessageRecipientResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<SendMaxMessageRecipientResult>

  if (
    typeof row.normalized_phone === 'string' &&
    (row.status === 'sent' || row.status === 'failed' || row.status === 'skipped')
  ) {
    return {
      normalized_phone: row.normalized_phone,
      status: row.status,
      max_message_id: typeof row.max_message_id === 'string' ? row.max_message_id : null,
      error_message: typeof row.error_message === 'string' ? row.error_message : null,
    }
  }

  return null
}

function parseSendResult(value: unknown): SendMaxMessageResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<SendMaxMessageResult>

  if (
    typeof row.batch_id === 'string' &&
    (row.status === 'sent' || row.status === 'partial' || row.status === 'failed')
  ) {
    return {
      batch_id: row.batch_id,
      status: row.status,
      results: Array.isArray(row.results)
        ? row.results
            .map(parseRecipientResult)
            .filter((item): item is SendMaxMessageRecipientResult => Boolean(item))
        : [],
    }
  }

  return null
}

export async function sendMaxMessage({
  recipientPhones,
  templateId,
  messageText,
}: SendMaxMessageParams) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase.functions.invoke('max-send-message', {
    body: {
      recipient_phones: recipientPhones,
      template_id: templateId ?? null,
      message_text: messageText,
    },
  })

  if (error) {
    throw new Error(error.message)
  }

  const parsed = parseSendResult(data)

  if (!parsed) {
    throw new Error('Unexpected max-send-message response.')
  }

  return parsed
}
