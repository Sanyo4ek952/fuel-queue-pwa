import type { ReactNode } from 'react'

import { Toaster } from '@/shared/ui/sonner'

export function SyncProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="top-center" />
    </>
  )
}
