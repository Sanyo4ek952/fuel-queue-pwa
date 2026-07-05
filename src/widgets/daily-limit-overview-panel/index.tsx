import { CalendarDays, CloudOff, Fuel, Gauge } from 'lucide-react'
import { useState } from 'react'

import { useDailyLimitOverview, type DailyLimitOverviewResult } from '@/entities/daily-limit'
import { StationSelect, useSelectedStation } from '@/features/select-station'
import type { FuelType } from '@/shared/constants'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'

const fuelTypeLabels: Record<FuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
  OTHER: 'Другое',
}

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

function LimitSummary({ overview }: { overview: DailyLimitOverviewResult }) {
  if (!overview.exists || !overview.status) {
    return null
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <Gauge className="size-5 text-slate-500" aria-hidden="true" />
            Текущий лимит
          </span>
          <Badge variant={statusVariants[overview.status]} className="rounded-md">
            {statusLabels[overview.status]}
          </Badge>
        </CardTitle>
        <CardDescription>
          {overview.date}
          {overview.updated_at ? ` · обновлено ${new Date(overview.updated_at).toLocaleString('ru-RU')}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {overview.status !== 'OPEN' ? (
          <Alert className="border-amber-200 bg-amber-50 text-amber-950">
            <AlertTitle>Лимит не открыт</AlertTitle>
            <AlertDescription>
              Новые записи на эту дату и АЗС будут заблокированы серверными правилами.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-3 gap-2">
          <SummaryTile label="Машин всего" value={formatNumber(overview.total_vehicle_limit)} />
          <SummaryTile label="Записано" value={overview.occupied_vehicle_count} />
          <SummaryTile label="Осталось" value={formatNumber(overview.remaining_vehicle_count)} />
        </div>
        <SummaryTile
          label="Литров на авто"
          value={`${formatNumber(overview.max_liters_per_vehicle)} л`}
        />
      </CardContent>
    </Card>
  )
}

function FuelTypeTable({ overview }: { overview: DailyLimitOverviewResult }) {
  if (!overview.exists) {
    return null
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fuel className="size-5 text-slate-500" aria-hidden="true" />
          Остатки по топливу
        </CardTitle>
        <CardDescription>
          Активные записи: RESERVED, ARRIVED, APPROVED, FUELING.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Топливо</TableHead>
              <TableHead className="text-right">Лимит</TableHead>
              <TableHead className="text-right">Записано</TableHead>
              <TableHead className="text-right">Осталось</TableHead>
              <TableHead className="text-right">Литры</TableHead>
              <TableHead className="text-right">Остаток л</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.fuel_type_overviews.map((row) => {
              const isFilled = row.vehicle_limit > 0 && row.remaining_vehicle_count === 0
              const isLitersFilled = row.liters_limit != null && row.remaining_liters === 0

              return (
                <TableRow key={row.fuel_type}>
                  <TableCell className="font-medium">
                    {fuelTypeLabels[row.fuel_type] ?? row.fuel_type}
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(row.vehicle_limit)}</TableCell>
                  <TableCell className="text-right">{formatNumber(row.occupied_vehicle_count)}</TableCell>
                  <TableCell className="text-right">
                    <span className={isFilled ? 'font-semibold text-red-700' : undefined}>
                      {formatNumber(row.remaining_vehicle_count)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(row.liters_limit)}</TableCell>
                  <TableCell className="text-right">
                    <span className={isLitersFilled ? 'font-semibold text-red-700' : undefined}>
                      {formatNumber(row.remaining_liters)}
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function DailyLimitOverviewPanel() {
  const selectedStationId = useSelectedStation((state) => state.selectedStationId)
  const [date, setDate] = useState(getTodayDateInputValue)
  const overviewQuery = useDailyLimitOverview({ stationId: selectedStationId, date })
  const overview = overviewQuery.data

  return (
    <div className="space-y-4">
      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-5 text-slate-500" aria-hidden="true" />
            Обзор лимитов
          </CardTitle>
          <CardDescription>Выберите АЗС и дату, чтобы увидеть занятость и остатки.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <StationSelect />
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="daily-limit-date">
              Дата
            </label>
            <Input
              id="daily-limit-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {!selectedStationId ? (
        <Alert>
          <AlertTitle>АЗС не выбрана</AlertTitle>
          <AlertDescription>Выберите АЗС, чтобы загрузить лимит на дату.</AlertDescription>
        </Alert>
      ) : null}

      {overview && overview.source === 'offline' ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <CloudOff className="size-4" aria-hidden="true" />
          <AlertTitle>Offline snapshot</AlertTitle>
          <AlertDescription>
            Показан локальный снимок. Остатки не считаются окончательными до синхронизации.
          </AlertDescription>
        </Alert>
      ) : null}

      {overview?.is_estimated && overview.unsynced_reservation_count > 0 ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <AlertTitle>Оценочный остаток</AlertTitle>
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

      {selectedStationId && overviewQuery.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Загрузка лимита...
        </div>
      ) : null}

      {selectedStationId && !overviewQuery.isLoading && overview && !overview.exists ? (
        <Alert>
          <AlertTitle>
            {overview.source === 'offline' ? 'Локальный снимок не найден' : 'Лимит не создан'}
          </AlertTitle>
          <AlertDescription>
            {overview.source === 'offline'
              ? 'Подключитесь к интернету, чтобы загрузить актуальные данные по лимиту.'
              : 'Создайте лимит ниже, чтобы открыть запись на выбранную дату и АЗС.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {overview?.exists ? (
        <>
          <LimitSummary overview={overview} />
          <FuelTypeTable overview={overview} />
        </>
      ) : null}
    </div>
  )
}
