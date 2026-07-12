import { isSupabaseConfigured } from '@/shared/config/env'
import type { SyncStatus } from '@/shared/constants'

import type { RpcResult } from './index'
import { requestProtectedRpcApi } from './protected-api'

export type SyncOfflineMutationParams = {
  clientMutationId: string
  operationType: string
  payload: unknown
}

export type SyncOfflineMutationResult = {
  status: SyncStatus
  operation_type: string
  client_mutation_id: string
  data?: unknown
  reason?: string
  payload?: unknown
}

function parseSyncOfflineMutationResult(value: unknown): SyncOfflineMutationResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<SyncOfflineMutationResult>

  if (
    typeof result.status === 'string' &&
    typeof result.operation_type === 'string' &&
    typeof result.client_mutation_id === 'string'
  ) {
    return {
      status: result.status as SyncStatus,
      operation_type: result.operation_type,
      client_mutation_id: result.client_mutation_id,
      data: result.data,
      reason: result.reason,
      payload: result.payload,
    }
  }

  return null
}

export async function syncOfflineMutation({
  clientMutationId,
  operationType,
  payload,
}: SyncOfflineMutationParams): Promise<RpcResult<SyncOfflineMutationResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/sync-offline-mutation',
      {
        clientMutationId,
        operationType,
        payload,
      },
      'Sync offline mutation request failed.',
    )
    const parsed = parseSyncOfflineMutationResult(data)

    if (!parsed) {
      return {
        data: null,
        error: 'Unexpected sync_offline_mutation response.',
      }
    }

    return {
      data: parsed,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Sync offline mutation request failed.',
    }
  }
}
