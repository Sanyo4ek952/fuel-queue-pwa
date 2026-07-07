import { zodResolver } from '@hookform/resolvers/zod'
import { BarChart3, CalendarDays, Filter, Fuel, Gauge, Hash, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'

import {
  type FuelingReportFilterInput,
  type FuelingReportFilterValues,
  type FuelingReportPeriodPreset,
  FUELING_REPORT_PERIOD_PRESETS,
  fuelingReportFilterSchema,
  getFuelingReportPresetDateRange,
} from '../model/schema'
import { useFuelingReport } from '../model/use-fueling-report'
import { STATIONS } from '@/shared/config/stations'
import type { FuelType } from '@/shared/constants'
import type {
  FuelingReportDayRow,
  FuelingReportFuelTypeRow,
  FuelingReportStationRow,
} from '@/shared/api/rpc'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'

const fuelTypeLabels: Record<FuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
  OTHER: 'Другое',
}

const periodLabels: Record<FuelingReportPeriodPreset, string> = {
  today: 'Сегодня',
  week: '7 дней',
  month: '30 дней',
  custom: 'Период',
}

const numberFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
})

function formatNumber(value: number) {
  return numberFormatter.format(value)
}

function formatLiters(value: number) {
  return `${formatNumber(value)} л`
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00`))
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Fuel
  label: string
  value: string
}) {
  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardContent className="flex items-center gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-1 truncate text-xl font-semibold text-slate-950">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyRows({ colSpan }: { colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-24 text-center text-sm text-slate-500">
        За выбранный период данных нет.
      </TableCell>
    </TableRow>
  )
}

function StationTable({ rows }: { rows: FuelingReportStationRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>АЗС</TableHead>
          <TableHead>Литры</TableHead>
          <TableHead>Заправки</TableHead>
          <TableHead>Машины</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? <EmptyRows colSpan={4} /> : null}
        {rows.map((row) => (
          <TableRow key={row.station_id}>
            <TableCell className="font-medium">{row.station_name}</TableCell>
            <TableCell>{formatLiters(row.total_liters)}</TableCell>
            <TableCell>{formatNumber(row.fueling_count)}</TableCell>
            <TableCell>{formatNumber(row.unique_vehicle_count)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function FuelTypeTable({ rows }: { rows: FuelingReportFuelTypeRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Топливо</TableHead>
          <TableHead>Литры</TableHead>
          <TableHead>Заправки</TableHead>
          <TableHead>Машины</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? <EmptyRows colSpan={4} /> : null}
        {rows.map((row) => (
          <TableRow key={row.fuel_type}>
            <TableCell className="font-medium">
              {fuelTypeLabels[row.fuel_type as FuelType] ?? row.fuel_type}
            </TableCell>
            <TableCell>{formatLiters(row.total_liters)}</TableCell>
            <TableCell>{formatNumber(row.fueling_count)}</TableCell>
            <TableCell>{formatNumber(row.unique_vehicle_count)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function DayTable({ rows }: { rows: FuelingReportDayRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Дата</TableHead>
          <TableHead>Литры</TableHead>
          <TableHead>Заправки</TableHead>
          <TableHead>Машины</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? <EmptyRows colSpan={4} /> : null}
        {rows.map((row) => (
          <TableRow key={row.date}>
            <TableCell className="font-medium">{formatDate(row.date)}</TableCell>
            <TableCell>{formatLiters(row.total_liters)}</TableCell>
            <TableCell>{formatNumber(row.fueling_count)}</TableCell>
            <TableCell>{formatNumber(row.unique_vehicle_count)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function FuelingReportView() {
  const defaultRange = getFuelingReportPresetDateRange('today')
  const form = useForm<FuelingReportFilterInput, unknown, FuelingReportFilterValues>({
    resolver: zodResolver(fuelingReportFilterSchema),
    defaultValues: {
      periodPreset: 'today',
      dateFrom: defaultRange.dateFrom,
      dateTo: defaultRange.dateTo,
      stationId: 'all',
    },
    mode: 'onChange',
  })
  const watchedFilters = form.watch()
  const parsedFilters = useMemo(() => {
    const result = fuelingReportFilterSchema.safeParse(watchedFilters)
    return result.success ? result.data : null
  }, [watchedFilters])
  const reportQuery = useFuelingReport({ filters: parsedFilters })
  const report = reportQuery.data
  const summary = report?.summary ?? {
    total_liters: 0,
    fueling_count: 0,
    unique_vehicle_count: 0,
    average_liters_per_fueling: 0,
  }

  function handlePresetChange(value: string) {
    const periodPreset = value as FuelingReportPeriodPreset
    form.setValue('periodPreset', periodPreset, { shouldDirty: true, shouldValidate: true })

    if (periodPreset !== 'custom') {
      const range = getFuelingReportPresetDateRange(periodPreset)
      form.setValue('dateFrom', range.dateFrom, { shouldDirty: true, shouldValidate: true })
      form.setValue('dateTo', range.dateTo, { shouldDirty: true, shouldValidate: true })
    }
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="size-5 text-slate-500" aria-hidden="true" />
            Фильтры отчета
          </CardTitle>
          <CardDescription>Агрегированные данные по подтвержденным заправкам.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FormItem>
                <FormLabel htmlFor="periodPreset">Период</FormLabel>
                <Select value={watchedFilters.periodPreset} onValueChange={handlePresetChange}>
                  <SelectTrigger id="periodPreset" className="h-10 w-full bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    {FUELING_REPORT_PERIOD_PRESETS.map((preset) => (
                      <SelectItem key={preset} value={preset}>
                        {periodLabels[preset]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>

              <FormItem>
                <FormLabel htmlFor="dateFrom">С</FormLabel>
                <Input
                  id="dateFrom"
                  type="date"
                  {...form.register('dateFrom', {
                    onChange: () =>
                      form.setValue('periodPreset', 'custom', {
                        shouldDirty: true,
                        shouldValidate: true,
                      }),
                  })}
                />
                {form.formState.errors.dateFrom ? (
                  <FormMessage>{form.formState.errors.dateFrom.message}</FormMessage>
                ) : null}
              </FormItem>

              <FormItem>
                <FormLabel htmlFor="dateTo">По</FormLabel>
                <Input
                  id="dateTo"
                  type="date"
                  {...form.register('dateTo', {
                    onChange: () =>
                      form.setValue('periodPreset', 'custom', {
                        shouldDirty: true,
                        shouldValidate: true,
                      }),
                  })}
                />
                {form.formState.errors.dateTo ? (
                  <FormMessage>{form.formState.errors.dateTo.message}</FormMessage>
                ) : null}
              </FormItem>

              <FormItem>
                <FormLabel htmlFor="stationId">АЗС</FormLabel>
                <Select
                  value={watchedFilters.stationId}
                  onValueChange={(value) =>
                    form.setValue('stationId', value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger id="stationId" className="h-10 w-full bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    <SelectItem value="all">Все АЗС</SelectItem>
                    {STATIONS.map((station) => (
                      <SelectItem key={station.id} value={station.id}>
                        {station.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            </form>
          </Form>
        </CardContent>
      </Card>

      {form.formState.errors.dateTo || form.formState.errors.dateFrom ? (
        <Alert variant="destructive">
          <AlertTitle>Проверьте период</AlertTitle>
          <AlertDescription>
            {form.formState.errors.dateTo?.message ?? form.formState.errors.dateFrom?.message}
          </AlertDescription>
        </Alert>
      ) : null}

      {reportQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Отчет не загружен</AlertTitle>
          <AlertDescription>{reportQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {reportQuery.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Загружаем отчет...
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={Fuel} label="Литры" value={formatLiters(summary.total_liters)} />
        <SummaryCard icon={Hash} label="Заправки" value={formatNumber(summary.fueling_count)} />
        <SummaryCard
          icon={Gauge}
          label="Уникальные машины"
          value={formatNumber(summary.unique_vehicle_count)}
        />
        <SummaryCard
          icon={BarChart3}
          label="Средний объем"
          value={formatLiters(summary.average_liters_per_fueling)}
        />
      </div>

      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="size-5 text-slate-500" aria-hidden="true" />
              Детализация
            </CardTitle>
            <CardDescription>
              {parsedFilters
                ? `${formatDate(parsedFilters.dateFrom)} - ${formatDate(parsedFilters.dateTo)}`
                : 'Выберите корректный период'}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={reportQuery.isFetching || !parsedFilters}
            onClick={() => void reportQuery.refetch()}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Обновить
          </Button>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="stations">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="stations">По АЗС</TabsTrigger>
              <TabsTrigger value="fuel-types">По топливу</TabsTrigger>
              <TabsTrigger value="days">По дням</TabsTrigger>
            </TabsList>
            <TabsContent value="stations" className="mt-4 overflow-x-auto">
              <StationTable rows={report?.by_station ?? []} />
            </TabsContent>
            <TabsContent value="fuel-types" className="mt-4 overflow-x-auto">
              <FuelTypeTable rows={report?.by_fuel_type ?? []} />
            </TabsContent>
            <TabsContent value="days" className="mt-4 overflow-x-auto">
              <DayTable rows={report?.by_day ?? []} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
