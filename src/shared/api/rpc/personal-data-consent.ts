import { isSupabaseConfigured } from '@/shared/config/env'
import type { PersonalDataConsentSnapshot } from '@/shared/config/personal-data-consent'

import type { RpcResult } from './index'
import { requestProtectedRpcApi } from './protected-api'

export type RecordPersonalDataConsentResult = {
  id: string
  profile_id: string
  auth_user_id: string
  document_version: string
  document_hash: string
  accepted_at: string
}

function parseRecordPersonalDataConsentResult(
  value: unknown,
): RecordPersonalDataConsentResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Partial<RecordPersonalDataConsentResult>

  if (
    typeof row.id === 'string' &&
    typeof row.profile_id === 'string' &&
    typeof row.auth_user_id === 'string' &&
    typeof row.document_version === 'string' &&
    typeof row.document_hash === 'string' &&
    typeof row.accepted_at === 'string'
  ) {
    return {
      id: row.id,
      profile_id: row.profile_id,
      auth_user_id: row.auth_user_id,
      document_version: row.document_version,
      document_hash: row.document_hash,
      accepted_at: row.accepted_at,
    }
  }

  return null
}

export async function recordPersonalDataConsent(
  snapshot: PersonalDataConsentSnapshot,
): Promise<RpcResult<RecordPersonalDataConsentResult>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  try {
    const data = await requestProtectedRpcApi(
      '/api/record-personal-data-consent',
      {
        documentVersion: snapshot.documentVersion,
        documentHash: snapshot.documentHash,
        acceptedAt: snapshot.acceptedAt,
        source: snapshot.source,
        registrationRole: snapshot.registrationRole,
        userAgent: snapshot.userAgent,
      },
      'Record personal data consent request failed.',
    )
    const parsed = parseRecordPersonalDataConsentResult(data)

    if (!parsed) {
      return {
        data: null,
        error: 'Unexpected record_personal_data_consent response.',
      }
    }

    return {
      data: parsed,
      error: null,
    }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Record personal data consent request failed.',
    }
  }
}
