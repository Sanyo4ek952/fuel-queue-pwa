import { CalendarDays, CloudOff, Fuel, Gauge } from 'lucide-react'
import { useState } from 'react'

import {
  useDailyLimitOverview,
  type DailyLimitOverviewResult,
} from '@/entities/daily-limit'
import type { DailyLimitCategoryOverview } from '@/shared/api/rpc'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'

const statusLabels = {
  OPEN: 'Открыт',
  CLOSED: 'Закрыт',
  PAUSED: 'Пауза',
} as const

const statusVariants = {
  OPEN: 'default',
  CLOSED: 'destructive',
  PAUSED: 'secondary',
} as const

function formatNumber(value: number | null | undefined) {
  if (value == null) {
    return 'Без лимита'
  }

  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(value)
}

function SummaryTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  )
}

function CategoryCard({ row }: { row: DailyLimitCategoryOverview }) {
  const limitValue =
    row.limit_mode === 'vehicle_count'
      ? `${formatNumber(row.vehicle_limit)} машин`
      : `${formatNumber(row.liters_limit)} л`
  const remainingValue =
    row.limit_mode === 'vehicle_count'
      ? `${formatNumber(row.remaining_vehicle_count)} машин`
      : `${formatNumber(row.remaining_liters)} л`

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{row.label}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {row.limit_mode === 'vehicle_count' ? 'Лимит по машинам' : 'Лимит по топливу'}
          </p>
        </div>
        <Badge variant="outline" className="rounded-md">
          {limitValue}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <SummaryTile label="В очереди" value={row.queue_count} />
        <SummaryTile label="Пройдёт" value={row.covered_vehicle_count} />
        <SummaryTile label="Заявлено л" value={formatNumber(row.queued_liters)} />
        <SummaryTile label="Покрыто л" value={formatNumber(row.covered_liters)} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <SummaryTile label="Остаток" value={remainingValue} />
        <SummaryTile
          label="Хватит до №"
          value={row.projected_queue_number ?? 'Нет прогноза'}
        />
      </div>
    </article>
  )
}

function LimitSummary({ overview }: { overview: DailyLimitOverviewResult }) {
  if (!overview.exists || !overview.status) {
    return null
  }

  const categoryOverviews = overview.category_overviews ?? []
  const totalQueue = categoryOverviews.reduce((sum, item) => sum + item.queue_count, 0)
  const totalCovered = categoryOverviews.reduce(
    (sum, item) => sum + item.covered_vehicle_count,
    0,
  )
  const lastQueueNumber = categoryOverviews.reduce<number | null>(
    (maxQueueNumber, item) =>
      item.projected_queue_number == null
        ? maxQueueNumber
        : Math.max(maxQueueNumber ?? 0, item.projected_queue_number),
    null,
  )

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Gauge className="size-5 text-slate-500" aria-hidden="true" />
            Прогноз дня
          </span>
          <Badge variant={statusVariants[overview.status]} className="rounded-md">
            {statusLabels[overview.status]}
          </Badge>
        </CardTitle>
        <CardDescription>
          {overview.date}
          {overview.updated_at
            ? ` · обновлено ${new Date(overview.updated_at).toLocaleString('ru-RU')}`
            : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2">
        <SummaryTile label="В очереди" value={totalQueue} />
        <SummaryTile label="Заправится" value={totalCovered} />
        <SummaryTile label="До номера" value={lastQueueNumber ?? 'Нет'} />
      </CardContent>
    </Card>
  )
}

export function DailyLimitOverviewPanel() {
  const [date, setDate] = useState(getTodayDateInputValue)
  const overviewQuery = useDailyLimitOverview({ date })
  const overview = overviewQuery.data

  return (
    <div className="space-y-4">
      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-5 text-slate-500" aria-hidden="true" />
            Обзор лимитов
          </CardTitle>
          <CardDescription>
            Прогноз считается по единой очереди отдельно для бензина, дизеля и газа.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-xs">
          <label className="text-sm font-medium text-slate-700" htmlFor="daily-limit-date">
            Дата
          </label>
          <Input
            id="daily-limit-date"
            className="mt-2"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </CardContent>
      </Card>

      {overview && overview.source === 'offline' ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <CloudOff className="size-4" aria-hidden="true" />
          <AlertTitle>Offline snapshot</AlertTitle>
          <AlertDescription>
            Показан локальный снимок. Прогноз будет перепроверен после синхронизации.
          </AlertDescription>
        </Alert>
      ) : null}

      {overview?.is_estimated && overview.unsynced_reservation_count > 0 ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <AlertTitle>Оценочный прогноз</AlertTitle>
          <AlertDescription>
            Учтены локальные несинхронизированные записи: {overview.unsynced_reservation_count}.
          </AlertDescription>
        </Alert>
      ) : null}

      {overviewQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Лимит не загружен</AlertTitle>
          <AlertDescription>{overviewQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {overviewQuery.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Загрузка лимита...
        </div>
      ) : null}

      {!overviewQuery.isLoading && overview && !overview.exists ? (
        <Alert>
          <Fuel className="size-4" aria-hidden="true" />
          <AlertTitle>Лимит не создан</AlertTitle>
          <AlertDescription>
            Мэр должен задать лимит на дату, чтобы проверка начала пропускать машины из очереди.
          </AlertDescription>
        </Alert>
      ) : null}

      {overview?.exists ? (
        <>
          <LimitSummary overview={overview} />
          <div className="grid gap-3 lg:grid-cols-3">
            {(overview.category_overviews ?? []).map((row) => (
              <CategoryCard key={row.fuel_type ?? row.fuel_category} row={row} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
