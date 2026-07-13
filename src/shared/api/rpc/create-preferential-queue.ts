import { isSupabaseConfigured } from '@/shared/config/env'

import type { RpcResult } from './index'
import { requestProtectedRpcApi } from './protected-api'

export type PreferentialQueueStatus = 'ACTIVE' | 'ARCHIVED'

export type CreatePreferentialQueueParams = {
  name: string
  clientMutationId: string
}

export type CreatePreferentialQueueResult = {
  id: string
  name: string
  status: PreferentialQueueStatus
  created_by: string
  client_mutation_id: string
  created_at: string
  updated_at: string
}

export function parseCreatePreferentialQueueResult(
  value: unknown,
): CreatePreferentialQueueResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = value as Partial<CreatePreferentialQueueResult>

  if (
    typeof result.id === 'string' &&
    typeof result.name === 'string' &&
    typeof result.status === 'string' &&
    typeof result.created_by === 'string' &&
    typeof result.client_mutation_id === 'string' &&
    typeof result.created_at === 'string' &&
    typeof result.updated_at === 'string'
  ) {
    return {
      id: result.id,
      name: result.name,
      status: result.status as PreferentialQueueStatus,
      created_by: result.created_by,
      client_mutation_id: result.client_mutation_id,
      created_at: result.created_at,
      updated_at: result.updated_at,
    }
  }

  return null
}

export async function createPreferentialQueue({
  name,
  clientMutationId,
}: CreatePreferentialQueueParams): Promise<RpcResult<CreatePreferentialQueueResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/create-preferential-queue',
      { name, clientMutationId },
      'Create preferential queue request failed.',
    )
    const parsed = parseCreatePreferentialQueueResult(data)

    if (!parsed) {
      return {
        data: null,
        error: 'Unexpected create_preferential_queue response.',
      }
    }

    return {
      data: parsed,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Create preferential queue request failed.',
    }
  }
}
