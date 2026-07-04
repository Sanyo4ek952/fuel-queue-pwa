import { WifiOff } from 'lucide-react'

import { useOnlineStatus } from '@/shared/lib/sync'

export function OfflineBanner() {
  const isOnline = useOnlineStatus()

  if (isOnline) {
    return null
  }

  return (
    <div className="bg-amber-100 px-4 py-2 text-sm font-medium text-amber-950">
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <WifiOff className="size-4 shrink-0" aria-hidden="true" />
        <span>Вы офлайн. Действия сохраняются локально и будут синхронизированы позже.</span>
      </div>
    </div>
  )
}
