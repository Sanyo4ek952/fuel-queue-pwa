import { PreferentialQueuesPanel } from '@/widgets/preferential-queues-panel'

export function PreferentialQueuesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Льготные очереди</h1>
        <p className="mt-1 text-sm text-slate-500">
          Именованные очереди мэра для приоритетного допуска к заправке.
        </p>
      </div>
      <PreferentialQueuesPanel />
    </div>
  )
}
