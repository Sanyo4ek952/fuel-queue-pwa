import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { currentProfileQueryKey } from '@/entities/profile'
import { getAuthSession, subscribeToAuthSessionChange } from '@/shared/api/auth'

import { SupabaseAuthContext } from './auth-context'

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    getAuthSession()
      .then((result) => {
        if (!isMounted) {
          return
        }

        setSession(result.data)
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    const unsubscribe = subscribeToAuthSessionChange((nextSession) => {
      setSession(nextSession)

      if (nextSession) {
        void queryClient.invalidateQueries({ queryKey: currentProfileQueryKey })
        return
      }

      queryClient.removeQueries({ queryKey: currentProfileQueryKey })
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [queryClient])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
    }),
    [isLoading, session],
  )

  return <SupabaseAuthContext.Provider value={value}>{children}</SupabaseAuthContext.Provider>
}
