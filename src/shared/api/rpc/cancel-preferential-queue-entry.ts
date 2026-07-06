import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'

import type { PreferentialQueueEntryStatus } from './create-preferential-queue-entry'
import type { RpcResult } from './index'

export type CancelPreferentialQueueEntryParams = {
  entryId: string
  comment?: string
}

export type CancelPreferentialQueueEntryResult = {
  id: string
  queue_id: string
  status: PreferentialQueueEntryStatus
  cancelled_comment: string | null
  cancelled_at: string | null
}

export function parseCancelPreferentialQueueEntryResult(
  value: unknown,
): CancelPreferentialQueueEntryResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<CancelPreferentialQueueEntryResult>

  if (
    typeof result.id === 'string' &&
    typeof result.queue_id === 'string' &&
    typeof result.status === 'string'
  ) {
    return {
      id: result.id,
      queue_id: result.queue_id,
      status: result.status as PreferentialQueueEntryStatus,
      cancelled_comment: result.cancelled_comment ?? null,
      cancelled_at: result.cancelled_at ?? null,
    }
  }

  return null
}

export async function cancelPreferentialQueueEntry({
  entryId,
  comment,
}: CancelPreferentialQueueEntryParams): Promise<RpcResult<CancelPreferentialQueueEntryResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.rpc('cancel_preferential_queue_entry', {
    entry_id: entryId,
    comment: comment ?? null,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

  const parsed = parseCancelPreferentialQueueEntryResult(data)

  if (!parsed) {
    return {
      data: null,
      error: 'Unexpected cancel_preferential_queue_entry response.',
    }
  }

  return {
    data: parsed,
    error: null,
  }
}
