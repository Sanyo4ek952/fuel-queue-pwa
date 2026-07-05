import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, CheckCircle2, MapPin, Search, XCircle } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useForm } from 'react-hook-form'

import { useCurrentProfile } from '@/entities/profile'
import {
  type CheckVehicleFormValues,
  checkVehicleSchema,
  useCheckVehicleAccess,
  useVehicleFuelingHistory,
  type VehicleAccessReason,
  type VehicleAccessResult,
  type VehicleFuelingHistoryResult,
} from '@/features/check-vehicle'
import { CreateManualOverrideForm } from '@/features/create-manual-override'
import {
  getAvailableStations,
  type Station,
  useSelectedStation,
} from '@/features/select-station'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { canCreateManualOverride } from '@/shared/lib/permissions'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/shared/ui/accordion'
import { Button } from '@/shared/ui/button'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

const ALL_STATIONS_VALUE = '__ALL_STATIONS__'
const HISTORY_ACCORDION_VALUE = 'fueling-history'

const litersFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
})

const reasonLabels: Record<VehicleAccessReason, string> = {
  ACTIVE_RESERVATION: 'Есть активная запись на выбранную АЗС.',
  ALREADY_FUELED: 'Автомобиль уже заправлялся сегодня.',
  DAILY_LIMIT_NOT_OPEN: 'Лимит на выбранную дату не открыт.',
  INVALID_PLATE_NUMBER: 'Госномер не распознан.',
  LITERS_LIMIT_EXCEEDED: 'Запрошенный объём превышает лимит на автомобиль.',
  MANUAL_OVERRIDE_ACTIVE: 'Действует ручное разрешение.',
  NO_ACTIVE_RESERVATION: 'Нет активной записи на сегодня.',
  NO_DAILY_LIMIT: 'На сегодня не задан лимит по выбранной АЗС.',
  OFFLINE_UNCONFIRMED: 'Offline-проверка требует серверного подтверждения.',
  PROFILE_NOT_FOUND: 'Профиль пользователя не найден.',
  RESERVATION_AT_OTHER_STATION: 'Запись найдена на другой АЗС.',
  RPC_ERROR: 'Не удалось выполнить серверную проверку.',
  STATION_ACCESS_DENIED: 'Нет доступа к выбранной АЗС.',
  VEHICLE_BLOCKED: 'Автомобиль заблокирован.',
}

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

function getResultTone(result: VehicleAccessResult) {
  if (result.status === 'ALLOWED') {
    return {
      Icon: CheckCircle2,
      title: 'Допуск разрешён',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    }
  }

  if (result.status === 'WARNING') {
    return {
      Icon: AlertTriangle,
      title: 'Нужно подтверждение',
      className: 'border-amber-200 bg-amber-50 text-amber-950',
    }
  }

  return {
    Icon: XCircle,
    title: 'Допуск запрещён',
    className: 'border-red-200 bg-red-50 text-red-950',
  }
}

function VehicleAccessResultView({ result }: { result: VehicleAccessResult }) {
  const { Icon, title, className } = getResultTone(result)
  const reason = result.offline_reason ?? result.reason

  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-sm opacity-80">{reasonLabels[result.reason]}</p>
            {result.offline_reason ? (
              <p className="mt-1 text-sm opacity-80">
                Локальный вывод: {reasonLabels[reason]}
              </p>
            ) : null}
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="opacity-70">Номер</dt>
              <dd className="font-semibold tracking-wide">{result.normalized_plate_number}</dd>
            </div>
            {result.queue_number ? (
              <div>
                <dt className="opacity-70">Очередь</dt>
                <dd className="font-semibold">№{result.queue_number}</dd>
              </div>
            ) : null}
            {result.fuel_type ? (
              <div>
                <dt className="opacity-70">Топливо</dt>
                <dd className="font-semibold">{result.fuel_type}</dd>
              </div>
            ) : null}
            {result.requested_liters ? (
              <div>
                <dt className="opacity-70">Литры</dt>
                <dd className="font-semibold">{result.requested_liters}</dd>
              </div>
            ) : null}
          </dl>
          {result.offline ? (
            <p className="text-sm opacity-80">
              Данные сохранены локально и будут перепроверены сервером после синхронизации.
            </p>
          ) : null}
          {result.error ? <p className="text-sm opacity-80">{result.error}</p> : null}
        </div>
      </div>
    </div>
  )
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

function VehicleFuelingHistoryRecordsView({
  result,
  isLoading,
  isError,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
}: {
  result: VehicleFuelingHistoryResult | undefined
  isLoading: boolean
  isError: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  onLoadMore: () => void
}) {
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

function VehicleFuelingHistoryAccordion({
  plateNumber,
  value,
  onValueChange,
  result,
  isLoading,
  isError,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
}: {
  plateNumber: string
  value: string | undefined
  onValueChange: (value: string | undefined) => void
  result: VehicleFuelingHistoryResult | undefined
  isLoading: boolean
  isError: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  onLoadMore: () => void
}) {
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
          {result && result.records.length === 0 && result.total_fueling_count > 0 ? (
            <VehicleFuelingHistoryResultView result={result} />
          ) : (
            <VehicleFuelingHistoryRecordsView
              result={result}
              isLoading={isLoading}
              isError={isError}
              isFetchingNextPage={isFetchingNextPage}
              hasNextPage={hasNextPage}
              onLoadMore={onLoadMore}
            />
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function CheckStationScopeSelect({
  stations,
  value,
  onValueChange,
}: {
  stations: Station[]
  value: string
  onValueChange: (value: string) => void
}) {
  const triggerId = useId()

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-700" htmlFor={triggerId}>
        АЗС
      </label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={triggerId} className="h-11 w-full bg-white">
          <span className="flex min-w-0 items-center gap-2">
            <MapPin className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
            <SelectValue placeholder="Выберите АЗС" />
          </span>
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectItem value={ALL_STATIONS_VALUE}>Все АЗС</SelectItem>
          {stations.map((station) => (
            <SelectItem key={station.id} value={station.id}>
              {station.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function CheckVehicleForm() {
  const selectedStationId = useSelectedStation((state) => state.selectedStationId)
  const setSelectedStationId = useSelectedStation((state) => state.setSelectedStationId)
  const currentProfileQuery = useCurrentProfile()
  const stations = getAvailableStations(currentProfileQuery.data)
  const [stationScopeValue, setStationScopeValue] = useState(
    selectedStationId || ALL_STATIONS_VALUE,
  )
  const [historyPlateNumber, setHistoryPlateNumber] = useState('')
  const [historyAccordionValue, setHistoryAccordionValue] = useState<string | undefined>()
  const checkVehicleAccessMutation = useCheckVehicleAccess()
  const isHistoryOpen = historyAccordionValue === HISTORY_ACCORDION_VALUE
  const vehicleFuelingHistoryQuery = useVehicleFuelingHistory({
    plateNumber: historyPlateNumber,
    enabled: isHistoryOpen,
  })
  const form = useForm<CheckVehicleFormValues>({
    resolver: zodResolver(checkVehicleSchema),
    defaultValues: {
      plateNumber: '',
    },
  })
  const isAllStationsSelected = stationScopeValue === ALL_STATIONS_VALUE
  const selectedCheckStationId = isAllStationsSelected ? '' : stationScopeValue

  useEffect(() => {
    if (stationScopeValue === ALL_STATIONS_VALUE || !selectedStationId) {
      return
    }

    if (selectedStationId !== stationScopeValue) {
      setStationScopeValue(selectedStationId)
    }
  }, [selectedStationId, stationScopeValue])

  function handleStationScopeChange(value: string) {
    setStationScopeValue(value)
    checkVehicleAccessMutation.reset()
    setHistoryPlateNumber('')
    setHistoryAccordionValue(undefined)

    if (value !== ALL_STATIONS_VALUE) {
      setSelectedStationId(value)
    }
  }

  async function handleSubmit(values: CheckVehicleFormValues) {
    setHistoryPlateNumber(values.plateNumber)
    setHistoryAccordionValue(undefined)

    if (isAllStationsSelected) {
      checkVehicleAccessMutation.reset()
      return
    }

    if (!selectedCheckStationId) {
      setHistoryPlateNumber('')
      return
    }

    await checkVehicleAccessMutation.mutateAsync({
      plateNumber: values.plateNumber,
      stationId: selectedCheckStationId,
      checkDate: getTodayDateInputValue(),
    })
  }

  const isSubmitDisabled =
    (!isAllStationsSelected && !selectedCheckStationId) ||
    checkVehicleAccessMutation.isPending
  const accessResult = checkVehicleAccessMutation.data
  const fuelingHistoryResult = vehicleFuelingHistoryQuery.data?.pages[0]
  const fuelingHistoryRecords =
    vehicleFuelingHistoryQuery.data?.pages.flatMap((page) => page.records) ?? []
  const fuelingHistoryViewResult = fuelingHistoryResult
    ? {
        ...fuelingHistoryResult,
        records: fuelingHistoryRecords,
        has_more: vehicleFuelingHistoryQuery.hasNextPage,
        offline:
          fuelingHistoryResult.offline ||
          vehicleFuelingHistoryQuery.data?.pages.some((page) => page.offline),
        error:
          fuelingHistoryResult.error ??
          vehicleFuelingHistoryQuery.data?.pages.find((page) => page.error)?.error,
      }
    : undefined
  const currentProfile = currentProfileQuery.data
  const canShowManualOverride =
    Boolean(
      selectedCheckStationId &&
        accessResult &&
        currentProfile &&
        canCreateManualOverride(currentProfile.role),
    ) &&
    (accessResult?.status === 'BLOCKED' || accessResult?.offline_decision === 'BLOCKED') &&
    accessResult?.reason !== 'MANUAL_OVERRIDE_ACTIVE'

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
        <CheckStationScopeSelect
          stations={stations}
          value={stationScopeValue}
          onValueChange={handleStationScopeChange}
        />
        <FormItem>
          <FormLabel htmlFor="plateNumber">Госномер</FormLabel>
          <Input
            id="plateNumber"
            autoComplete="off"
            inputMode="text"
            placeholder="А123ВС"
            className="h-12 text-lg uppercase"
            {...form.register('plateNumber')}
          />
          {form.formState.errors.plateNumber ? (
            <FormMessage>{form.formState.errors.plateNumber.message}</FormMessage>
          ) : null}
        </FormItem>
        <Button type="submit" className="h-11 w-full gap-2" disabled={isSubmitDisabled}>
          <Search className="size-4" aria-hidden="true" />
          {checkVehicleAccessMutation.isPending
            ? 'Проверяем...'
            : 'Проверить'}
        </Button>
        {!isAllStationsSelected && !selectedCheckStationId ? (
          <p className="text-sm text-slate-500">Выберите АЗС перед проверкой.</p>
        ) : null}
        {accessResult ? <VehicleAccessResultView result={accessResult} /> : null}
        {historyPlateNumber ? (
          <VehicleFuelingHistoryAccordion
            plateNumber={historyPlateNumber}
            value={historyAccordionValue}
            onValueChange={setHistoryAccordionValue}
            result={fuelingHistoryViewResult}
            isLoading={vehicleFuelingHistoryQuery.isLoading}
            isError={vehicleFuelingHistoryQuery.isError}
            isFetchingNextPage={vehicleFuelingHistoryQuery.isFetchingNextPage}
            hasNextPage={vehicleFuelingHistoryQuery.hasNextPage}
            onLoadMore={() => {
              void vehicleFuelingHistoryQuery.fetchNextPage()
            }}
          />
        ) : null}
        {canShowManualOverride && accessResult ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-950">Ручное разрешение</h2>
              <p className="mt-1 text-sm text-slate-500">
                Доступно для старшего смены или администратора АЗС.
              </p>
            </div>
            <CreateManualOverrideForm
              stationId={selectedCheckStationId}
              plateNumber={accessResult.normalized_plate_number || form.getValues('plateNumber')}
              targetDate={getTodayDateInputValue()}
              onCreated={() => {
                checkVehicleAccessMutation.mutate({
                  plateNumber: form.getValues('plateNumber'),
                  stationId: selectedCheckStationId,
                  checkDate: getTodayDateInputValue(),
                })
              }}
            />
          </div>
        ) : null}
      </form>
    </Form>
  )
}
