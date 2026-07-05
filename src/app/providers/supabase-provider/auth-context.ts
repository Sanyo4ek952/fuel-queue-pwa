import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type SupabaseAuthContextValue = {
  session: Session | null
  user: User | null
  isLoading: boolean
}

export const SupabaseAuthContext = createContext<SupabaseAuthContextValue | null>(null)

export function useSupabaseAuth() {
  const value = useContext(SupabaseAuthContext)

  if (!value) {
    throw new Error('useSupabaseAuth must be used within SupabaseProvider.')
  }

  return value
}
