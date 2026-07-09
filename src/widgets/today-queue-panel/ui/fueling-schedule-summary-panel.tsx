import type { FuelingScheduleSummary } from '@/shared/lib/fueling-schedule'

import { categoryLabels } from '../model/labels'

export function FuelingScheduleSummaryPanel({
  summaries,
}: {
  summaries: FuelingScheduleSummary[]
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {summaries.map((summary) => (
        <div
          key={summary.fuelCategory}
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
        >
          <p className="text-xs font-medium text-slate-700">
            {categoryLabels[summary.fuelCategory]}
          </p>
          {summary.startTime ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div>
                <dt className="text-slate-500">Начало</dt>
                <dd className="font-medium text-slate-950">{summary.startTime}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Окончание</dt>
                <dd className="font-medium text-slate-950">{summary.endTime ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Интервал</dt>
                <dd className="font-medium text-slate-950">{summary.intervalMinutes} мин.</dd>
              </div>
              <div>
                <dt className="text-slate-500">Авто</dt>
                <dd className="font-medium text-slate-950">{summary.vehiclesPerInterval}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Расписание не задано</p>
          )}
        </div>
      ))}
    </div>
  )
}
