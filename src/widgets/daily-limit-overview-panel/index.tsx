import { CalendarDays, CloudOff, Fuel, Gauge } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  useDailyLimitOverview,
  type DailyLimitOverviewResult,
} from '@/entities/daily-limit'
import type { DailyLimitCategoryOverview, DailyLimitStationOverview } from '@/shared/api/rpc'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

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

const ALL_STATIONS_VALUE = 'all'

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

function CategoryCard({
  row,
  stationName,
}: {
  row: DailyLimitCategoryOverview
  stationName: string | null
}) {
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
          {stationName ? (
            <p className="mt-1 text-sm font-medium text-slate-700">{stationName}</p>
          ) : null}
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
      </div>
    </article>
  )
}

function LimitSummary({ overview }: { overview: DailyLimitStationOverview }) {
  if (!overview.exists || !overview.status) {
    return null
  }

  const categoryOverviews = overview.category_overviews ?? []
  const totalQueue = categoryOverviews.reduce((sum, item) => sum + item.queue_count, 0)
  const totalCovered = categoryOverviews.reduce(
    (sum, item) => sum + item.covered_vehicle_count,
    0,
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
          {overview.station_name ? `${overview.station_name} · ` : ''}
          {overview.date}
          {overview.station_address ? ` · ${overview.station_address}` : ''}
          {overview.updated_at
            ? ` · обновлено ${new Date(overview.updated_at).toLocaleString('ru-RU')}`
            : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <SummaryTile label="В очереди" value={totalQueue} />
        <SummaryTile label="Заправится" value={totalCovered} />
      </CardContent>
    </Card>
  )
}

function getAggregateOverview(overview: DailyLimitOverviewResult): DailyLimitStationOverview {
  return {
    exists: overview.exists,
    id: overview.id,
    date: overview.date,
    station_id: null,
    station_name: overview.station_name ?? 'Общий пул',
    station_address: overview.station_address,
    status: overview.status,
    category_overviews: overview.category_overviews,
    updated_at: overview.updated_at,
  }
}

export function DailyLimitOverviewPanel() {
  const [date, setDate] = useState(getTodayDateInputValue)
  const [selectedStationId, setSelectedStationId] = useState(ALL_STATIONS_VALUE)
  const overviewQuery = useDailyLimitOverview({ date })
  const overview = overviewQuery.data
  const stationOverviews = useMemo(
    () => overview?.station_overviews ?? [],
    [overview?.station_overviews],
  )
  const selectedStationOverview = stationOverviews.find(
    (stationOverview) => stationOverview.station_id === selectedStationId,
  )
  const selectedOverview = useMemo(() => {
    if (!overview?.exists) {
      return null
    }

    if (selectedStationId === ALL_STATIONS_VALUE) {
      return getAggregateOverview(overview)
    }

    return selectedStationOverview ?? getAggregateOverview(overview)
  }, [overview, selectedStationId, selectedStationOverview])

  useEffect(() => {
    if (
      selectedStationId !== ALL_STATIONS_VALUE &&
      !stationOverviews.some((stationOverview) => stationOverview.station_id === selectedStationId)
    ) {
      setSelectedStationId(ALL_STATIONS_VALUE)
    }
  }, [selectedStationId, stationOverviews])

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
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
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
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="daily-limit-station">
              АЗС
            </label>
            <Select value={selectedStationId} onValueChange={setSelectedStationId}>
              <SelectTrigger id="daily-limit-station" className="mt-2 h-10 w-full bg-white">
                <SelectValue placeholder="Выберите АЗС" />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value={ALL_STATIONS_VALUE}>Все станции</SelectItem>
                {stationOverviews
                  .filter((stationOverview) => stationOverview.station_id)
                  .map((stationOverview) => (
                    <SelectItem
                      key={stationOverview.station_id}
                      value={stationOverview.station_id ?? ''}
                    >
                      {stationOverview.station_name ?? stationOverview.station_id}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
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

      {selectedOverview ? (
        <section className="space-y-3">
          <LimitSummary overview={selectedOverview} />
          <div className="grid gap-3 lg:grid-cols-3">
            {(selectedOverview.category_overviews ?? []).map((row) => (
              <CategoryCard
                key={`${selectedOverview.station_id ?? 'aggregate'}-${row.fuel_type ?? row.fuel_category}`}
                row={row}
                stationName={selectedOverview.station_name}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
