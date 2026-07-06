import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/shared/ui/accordion'
import { Button } from '@/shared/ui/button'
import type { VehicleFuelingHistoryResult } from '@/features/check-vehicle'

const HISTORY_ACCORDION_VALUE = 'fueling-history'

const litersFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
})

function formatLiters(value: number) {
  return `${litersFormatter.format(value)} л`
}

function formatDateTime(value: string | null) {
  if (!value) {
    return '—'
  }

  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function VehicleFuelingHistoryResultView({ result }: { result: VehicleFuelingHistoryResult }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-slate-950">
      <div className="space-y-4">
        <div>
          <p className="font-medium">История заправок по всем АЗС</p>
          <p className="text-sm text-slate-500">
            {result.vehicle_found
              ? 'Агрегировано за всё время по всем 3 АЗС.'
              : 'Автомобиль с таким госномером пока не найден.'}
          </p>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Номер</dt>
            <dd className="font-semibold tracking-wide">{result.normalized_plate_number || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Всего заправок</dt>
            <dd className="font-semibold">{result.total_fueling_count}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Всего литров</dt>
            <dd className="font-semibold">{formatLiters(result.total_liters)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">По ручному разрешению</dt>
            <dd className="font-semibold">{result.manual_override_fueling_count}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Первая заправка</dt>
            <dd className="font-semibold">{formatDateTime(result.first_fueled_at)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Последняя заправка</dt>
            <dd className="font-semibold">{formatDateTime(result.last_fueled_at)}</dd>
          </div>
        </dl>
        {result.station_summaries.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">По АЗС</p>
            <div className="space-y-2">
              {result.station_summaries.map((station) => (
                <div
                  key={station.station_id}
                  className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">{station.station_name}</span>
                  <span className="shrink-0 font-semibold">
                    {station.fueling_count} / {formatLiters(station.total_liters)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {result.fuel_type_summaries.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">По топливу</p>
            <div className="space-y-2">
              {result.fuel_type_summaries.map((fuelType) => (
                <div
                  key={fuelType.fuel_type}
                  className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm"
                >
                  <span>{fuelType.fuel_type}</span>
                  <span className="font-semibold">
                    {fuelType.fueling_count} / {formatLiters(fuelType.total_liters)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {result.offline ? (
          <p className="text-sm text-amber-700">
            Offline-режим: показаны только данные, которые уже есть в локальном кэше.
          </p>
        ) : null}
        {result.error ? <p className="text-sm text-slate-500">{result.error}</p> : null}
      </div>
    </div>
  )
}

type VehicleFuelingHistoryRecordsViewProps = {
  result: VehicleFuelingHistoryResult | undefined
  isLoading: boolean
  isError: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  onLoadMore: () => void
}

function VehicleFuelingHistoryRecordsView({
  result,
  isLoading,
  isError,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
}: VehicleFuelingHistoryRecordsViewProps) {
  const records = result?.records ?? []

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-slate-950">
      <div className="space-y-4">
        {isLoading ? <p className="text-sm text-slate-500">Загружаем историю...</p> : null}
        {isError ? (
          <p className="text-sm text-red-700">Не удалось загрузить историю заправок.</p>
        ) : null}
        {result ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Номер</dt>
              <dd className="font-semibold tracking-wide">
                {result.normalized_plate_number || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Всего заправок</dt>
              <dd className="font-semibold">{result.total_fueling_count}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Всего литров</dt>
              <dd className="font-semibold">{formatLiters(result.total_liters)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Последняя заправка</dt>
              <dd className="font-semibold">{formatDateTime(result.last_fueled_at)}</dd>
            </div>
          </dl>
        ) : null}
        {result && records.length === 0 && result.total_fueling_count === 0 ? (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Заправок не найдено.
          </p>
        ) : null}
        {records.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Заправки</p>
            <div className="space-y-2">
              {records.map((record) => (
                <div
                  key={record.id}
                  className="rounded-md bg-slate-50 px-3 py-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{formatDateTime(record.fueled_at)}</p>
                      <p className="truncate text-slate-500">
                        {record.station_name} · {record.fuel_type}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold">{formatLiters(record.liters)}</span>
                  </div>
                  {record.is_manual_override || record.sync_status !== 'SYNCED' ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {record.is_manual_override ? 'Ручное разрешение' : null}
                      {record.is_manual_override && record.sync_status !== 'SYNCED' ? ' · ' : null}
                      {record.sync_status !== 'SYNCED' ? record.sync_status : null}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
          >
            {isFetchingNextPage ? 'Загружаем...' : 'Загрузить ещё'}
          </Button>
        ) : null}
        {result?.offline ? (
          <p className="text-sm text-amber-700">
            Offline-режим: показаны только данные, которые уже есть в локальном кэше.
          </p>
        ) : null}
        {result?.error ? <p className="text-sm text-slate-500">{result.error}</p> : null}
      </div>
    </div>
  )
}

export function VehicleFuelingHistoryPanel(props: VehicleFuelingHistoryRecordsViewProps) {
  const { result } = props

  if (result && result.records.length === 0 && result.total_fueling_count > 0) {
    return <VehicleFuelingHistoryResultView result={result} />
  }

  return <VehicleFuelingHistoryRecordsView {...props} />
}

export function VehicleFuelingHistoryAccordion({
  plateNumber,
  value,
  onValueChange,
  ...panelProps
}: VehicleFuelingHistoryRecordsViewProps & {
  plateNumber: string
  value: string | undefined
  onValueChange: (value: string | undefined) => void
}) {
  const result = panelProps.result

  return (
    <Accordion type="single" collapsible value={value} onValueChange={onValueChange}>
      <AccordionItem
        value={HISTORY_ACCORDION_VALUE}
        className="rounded-lg border border-slate-200 bg-white px-4"
      >
        <AccordionTrigger className="hover:no-underline">
          <span className="min-w-0">
            <span className="block font-medium">История заправок по всем АЗС</span>
            <span className="block truncate text-sm font-normal text-slate-500">
              {result
                ? `${result.total_fueling_count} / ${formatLiters(result.total_liters)}`
                : `Номер ${plateNumber}`}
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <VehicleFuelingHistoryPanel {...panelProps} />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
