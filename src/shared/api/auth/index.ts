import type { Session } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'

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

export type AuthSession = {
  user: User
  expires_at: number | null
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

async function clearSignupSession(session: Session | null): Promise<AuthResult<AuthSession>> {
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

type ApiErrorResponse = {
  error?: string
  status?: number
  code?: string
}

async function readApiJson<TData>(response: Response, fallbackMessage: string): Promise<AuthResult<TData>> {
  const value = (await response.json().catch(() => null)) as (TData & ApiErrorResponse) | null

  if (!response.ok) {
    return {
      data: null,
      error: value?.error ?? fallbackMessage,
      status: response.status,
      code: value?.code,
    }
  }

  return {
    data: value as TData,
    error: null,
  }
}

const authSessionChangeEvent = 'azs-auth-session-change'

function notifyAuthSessionChange(session: AuthSession | null) {
  window.dispatchEvent(new CustomEvent<AuthSession | null>(authSessionChangeEvent, { detail: session }))
}

export async function getAuthSession(): Promise<AuthResult<AuthSession>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: null,
    }
  }

  const response = await fetch('/api/auth/session', {
    credentials: 'same-origin',
  })

  return readApiJson<AuthSession>(response, 'Session request failed.')
}

export function subscribeToAuthSessionChange(onChange: (session: AuthSession | null) => void) {
  if (!isSupabaseConfigured) {
    return () => undefined
  }

  const listener = (event: Event) => {
    onChange((event as CustomEvent<AuthSession | null>).detail ?? null)
  }

  window.addEventListener(authSessionChangeEvent, listener)

  return () => window.removeEventListener(authSessionChangeEvent, listener)
}

export async function signInWithPassword({
  email,
  password,
}: LoginWithPasswordParams): Promise<AuthResult<AuthSession>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  })
  const result = await readApiJson<AuthSession>(response, 'Login request failed.')

  if (result.data) {
    notifyAuthSessionChange(result.data)
  }

  return result
}

export async function signInWithYandex(): Promise<AuthResult<true>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: 'Supabase is not configured.',
    }
  }

  return {
    data: null,
    error: 'Yandex ID login requires the secure server-side OAuth flow.',
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
}: SignUpWithPasswordParams): Promise<AuthResult<AuthSession>> {
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
}: SignUpConsumerWithPasswordParams): Promise<AuthResult<AuthSession>> {
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

  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  })
  const result = await readApiJson<{ ok?: boolean }>(response, 'Logout request failed.')

  if (!result.error) {
    notifyAuthSessionChange(null)
  }

  return {
    data: result.error ? null : true,
    error: result.error,
    status: result.status,
    code: result.code,
  }
}
