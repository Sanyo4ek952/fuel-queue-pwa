import type { ReactNode } from 'react'

import { PwaProvider } from './pwa-provider'
import { QueryProvider } from './query-provider'
import { RouterProvider } from './router-provider'
import { SupabaseProvider } from './supabase-provider'
import { SyncProvider } from './sync-provider'

export function AppProviders({ children }: { children?: ReactNode }) {
  return (
    <QueryProvider>
      <SupabaseProvider>
        <PwaProvider>
          <SyncProvider>{children ?? <RouterProvider />}</SyncProvider>
        </PwaProvider>
      </SupabaseProvider>
    </QueryProvider>
  )
}
