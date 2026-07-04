import { Cloud, CloudOff } from 'lucide-react'

import { useOnlineStatus } from '@/shared/lib/sync'
import { Badge } from '@/shared/ui/badge'

export function SyncStatusPanel() {
  const isOnline = useOnlineStatus()
  const Icon = isOnline ? Cloud : CloudOff

  return (
    <Badge variant="outline" className="gap-1.5 rounded-md border-slate-200 bg-white">
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{isOnline ? 'Online' : 'Offline'}</span>
    </Badge>
  )
}
