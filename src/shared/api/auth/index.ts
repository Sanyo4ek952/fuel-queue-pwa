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
