import { AlertTriangle, Cloud, CloudOff } from 'lucide-react'

import { useSyncOutbox } from '@/features/sync-offline'
import { useOnlineStatus } from '@/shared/lib/sync'
import { Badge } from '@/shared/ui/badge'

export function SyncStatusPanel() {
  const isOnline = useOnlineStatus()
  const { summary } = useSyncOutbox()
  const Icon = isOnline ? Cloud : CloudOff
  const label = isOnline ? 'Online' : 'Offline'

  return (
    <Badge variant="outline" className="gap-1.5 rounded-md border-slate-200 bg-white">
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{summary.problemCount > 0 ? `${label} · ${summary.problemCount}` : label}</span>
      {summary.problemCount > 0 ? (
        <AlertTriangle className="size-3.5 text-red-600" aria-hidden="true" />
      ) : null}
    </Badge>
  )
}
