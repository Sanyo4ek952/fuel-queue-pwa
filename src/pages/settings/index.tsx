import { useCurrentProfile } from '@/entities/profile'
import { QueueBackupExportCard } from '@/features/export-queue-backup'
import { RefuelCooldownSettingsCard } from '@/features/manage-refuel-cooldown'

export function SettingsPage() {
  const currentProfileQuery = useCurrentProfile()
  const canEditCooldown = currentProfileQuery.data?.role === 'mayor'
  const canExportQueueBackup = currentProfileQuery.data?.role === 'mayor'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950">Настройки</h1>
        <p className="mt-1 text-sm text-slate-500">Параметры приложения для общей очереди.</p>
      </div>
      {canExportQueueBackup ? <QueueBackupExportCard /> : null}
      <RefuelCooldownSettingsCard canEdit={canEditCooldown} />
    </div>
  )
}
