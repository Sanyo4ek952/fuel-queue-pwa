import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import type { PersonalDataConsentSnapshot } from '@/shared/config/personal-data-consent'

import type { RpcResult } from './index'

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

  const { data, error } = await supabase.rpc('record_personal_data_consent', {
    p_document_version: snapshot.documentVersion,
    p_document_hash: snapshot.documentHash,
    p_accepted_at: snapshot.acceptedAt,
    p_source: snapshot.source,
    p_registration_role: snapshot.registrationRole,
    p_user_agent: snapshot.userAgent,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
    }
  }

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
}

