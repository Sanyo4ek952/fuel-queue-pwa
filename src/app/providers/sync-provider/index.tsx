import { useEffect, type ReactNode } from 'react'

import { syncPendingOutbox } from '@/features/sync-offline'
import { useOnlineStatus } from '@/shared/lib/sync'
import { Toaster } from '@/shared/ui/sonner'

export function SyncProvider({ children }: { children: ReactNode }) {
  const isOnline = useOnlineStatus()

  useEffect(() => {
    if (!isOnline) {
      return
    }

    syncPendingOutbox()
      .catch(() => {
        // Individual operations keep their own sync state.
      })
  }, [isOnline])

  return (
    <>
      {children}
      <Toaster position="top-center" />
    </>
  )
}
