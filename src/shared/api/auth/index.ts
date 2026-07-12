import type { Session } from '@supabase/supabase-js'

import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'
import {
  createPersonalDataConsentSnapshot,
  type PersonalDataConsentRegistrationRole,
  type PersonalDataConsentSnapshot,
} from '@/shared/config/personal-data-consent'

export type AuthResult<TData> = {
  data: TData | null
  error: string | null
  status?: number
  code?: string
}

export type LoginWithPasswordParams = {
  email: string
  password: string
}

export type SignUpWithPasswordParams = {
  email: string
  password: string
  firstName: string
  lastName: string
  middleName?: string
  position: string
  signatureName: string
  requestedRole: 'cashier' | 'mayor_assistant'
  requestedStationId?: string
  captchaToken?: string
  personalDataConsentAccepted: true
}

export type SignUpConsumerWithPasswordParams = {
  email: string
  password: string
  firstName: string
  lastName: string
  middleName?: string
  phone?: string
  captchaToken?: string
  personalDataConsentAccepted: true
}

export type ResendSignupConfirmationEmailParams = {
  email: string
  captchaToken?: string
}

function getAuthErrorMeta(error: { status?: number; code?: string } | null | undefined) {
  return {
    status: error?.status,
    code: error?.code,
  }
}

function toConsentMetadata(snapshot: PersonalDataConsentSnapshot) {
  return {
    personal_data_consent_accepted: true,
    personal_data_consent_version: snapshot.documentVersion,
    personal_data_consent_document_hash: snapshot.documentHash,
    personal_data_consent_accepted_at: snapshot.acceptedAt,
    personal_data_consent_source: snapshot.source,
    personal_data_consent_registration_role: snapshot.registrationRole,
    personal_data_consent_user_agent: snapshot.userAgent ?? '',
  }
}

function createSignupConsentMetadata(registrationRole: PersonalDataConsentRegistrationRole) {
  return toConsentMetadata(
    createPersonalDataConsentSnapshot({
      registrationRole,
      source: 'email_password',
    }),
  )
}

async function clearSignupSession(session: Session | null): Promise<AuthResult<Session>> {
  if (!session) {
    return {
      data: null,
      error: null,
    }
  }

  const { error } = await supabase.auth.signOut()

  return {
    data: null,
    error: error?.message ?? null,
  }
}

export async function getAuthSession(): Promise<AuthResult<Session>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: null,
    }
  }

  const { data, error } = await supabase.auth.getSession()

  return {
    data: data.session,
    error: error?.message ?? null,
  }
}

export function subscribeToAuthSessionChange(onChange: (session: Session | null) => void) {
  if (!isSupabaseConfigured) {
    return () => undefined
  }

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    onChange(session)
  })

  return () => data.subscription.unsubscribe()
}

export async function signInWithPassword({
  email,
  password,
}: LoginWithPasswordParams): Promise<AuthResult<Session>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  return {
    data: data.session,
    error: error?.message ?? null,
  }
}

export async function signInWithYandex(): Promise<AuthResult<true>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'custom:yandex',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      scopes: 'login:info login:email',
    },
  })

  return {
    data: error ? null : true,
    error: error?.message ?? null,
    ...getAuthErrorMeta(error),
  }
}

export async function signUpWithPassword({
  email,
  password,
  firstName,
  lastName,
  middleName,
  position,
  signatureName,
  requestedRole,
  requestedStationId,
  captchaToken,
  personalDataConsentAccepted,
}: SignUpWithPasswordParams): Promise<AuthResult<Session>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      ...(captchaToken ? { captchaToken } : {}),
      data: {
        first_name: firstName,
        last_name: lastName,
        middle_name: middleName ?? '',
        position,
        signature_name: signatureName,
        requested_role: requestedRole,
        requested_station_id: requestedRole === 'cashier' ? (requestedStationId ?? '') : '',
        ...(personalDataConsentAccepted ? createSignupConsentMetadata(requestedRole) : {}),
      },
    },
  })

  if (error) {
    return {
      data: null,
      error: error.message,
      ...getAuthErrorMeta(error),
    }
  }

  return clearSignupSession(data.session)
}

export async function signUpConsumerWithPassword({
  email,
  password,
  firstName,
  lastName,
  middleName,
  phone,
  captchaToken,
  personalDataConsentAccepted,
}: SignUpConsumerWithPasswordParams): Promise<AuthResult<Session>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      ...(captchaToken ? { captchaToken } : {}),
      data: {
        first_name: firstName,
        last_name: lastName,
        middle_name: middleName ?? '',
        phone: phone ?? '',
        requested_role: 'consumer',
        ...(personalDataConsentAccepted ? createSignupConsentMetadata('consumer') : {}),
      },
    },
  })

  if (error) {
    return {
      data: null,
      error: error.message,
      ...getAuthErrorMeta(error),
    }
  }

  return clearSignupSession(data.session)
}

export async function resendSignupConfirmationEmail({
  email,
  captchaToken,
}: ResendSignupConfirmationEmailParams): Promise<AuthResult<true>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: captchaToken ? { captchaToken } : undefined,
  })

  if (error) {
    return {
      data: null,
      error: error.message,
      ...getAuthErrorMeta(error),
    }
  }

  return {
    data: true,
    error: null,
  }
}

export async function signOut(): Promise<AuthResult<true>> {
  if (!isSupabaseConfigured) {
    return {
      data: true,
      error: null,
    }
  }

  const { error } = await supabase.auth.signOut()

  return {
    data: error ? null : true,
    error: error?.message ?? null,
  }
}
