import { FuelingReportView } from '@/features/view-fueling-report'

export function ReportsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Отчеты</h1>
        <p className="mt-1 text-sm text-slate-500">
          Агрегированные отчеты по отпуску топлива для мэра.
        </p>
      </div>
      <FuelingReportView />
    </div>
  )
}
