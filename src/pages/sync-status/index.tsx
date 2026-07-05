import { SyncOutboxPanel } from '@/widgets/sync-outbox-panel'

export function SyncStatusPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Синхронизация</h1>
        <p className="mt-1 text-sm text-slate-500">Очередь offline-операций, ошибки и конфликты.</p>
      </div>
      <SyncOutboxPanel />
    </div>
  )
}
