import type { Session } from '@supabase/supabase-js'

import { isSupabaseConfigured } from '@/shared/config/env'
import { supabase } from '@/shared/api/supabase'

export type AuthResult<TData> = {
  data: TData | null
  error: string | null
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
}

export type SignUpConsumerWithPasswordParams = {
  email: string
  password: string
  firstName: string
  lastName: string
  middleName?: string
  phone?: string
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
      data: {
        first_name: firstName,
        last_name: lastName,
        middle_name: middleName ?? '',
        position,
        signature_name: signatureName,
        requested_role: requestedRole,
        requested_station_id: requestedRole === 'cashier' ? (requestedStationId ?? '') : '',
      },
    },
  })

  return {
    data: data.session,
    error: error?.message ?? null,
  }
}

export async function signUpConsumerWithPassword({
  email,
  password,
  firstName,
  lastName,
  middleName,
  phone,
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
      data: {
        first_name: firstName,
        last_name: lastName,
        middle_name: middleName ?? '',
        phone: phone ?? '',
        requested_role: 'consumer',
      },
    },
  })

  if (!error && !data.session) {
    return signInWithPassword({ email, password })
  }

  return {
    data: data.session,
    error: error?.message ?? null,
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
