import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'

import {
  CheckCircle2,
  CloudOff,
  ListChecks,
  Pencil,
  Phone,
  PhoneOff,
  RotateCcw,
  XCircle,
} from 'lucide-react'

import { useDailyLimitOverview } from '@/entities/daily-limit'
import { useTodayQueue, type TodayQueueRow } from '@/entities/reservation'
import { useLogReservationCall } from '@/features/log-reservation-call'
import {
  type UpdateReservationFuelPreferenceFormValues,
  updateReservationFuelPreferenceSchema,
  useUpdateReservationFuelPreference,
} from '@/features/update-reservation-fuel-preference'
import { ROLE_LABELS, type UserRole } from '@/shared/config/roles'
import {
  getFuelQueueCategory,
  isGasolineFuelType,
  type FuelPreferenceMode,
  type FuelQueueCategory,
  type FuelType,
  type QueueFuelType,
  QUEUE_FUEL_TYPES,
  type ReservationCallStatus,
} from '@/shared/constants'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { cn } from '@/shared/lib/utils'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/shared/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'

const fuelTypeLabels: Record<FuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
  OTHER: 'Другое',
}

const fuelPreferenceLabels: Record<FuelPreferenceMode, string> = {
  EXACT: 'Только выбранная марка',
  ANY_GASOLINE: 'Подойдёт АИ-92/95/100',
}

const categoryLabels: Record<FuelQueueCategory, string> = {
  GASOLINE: 'Бензин',
  DIESEL: 'Дизель',
  GAS: 'Газ',
}

const categoryOrder: FuelQueueCategory[] = ['GASOLINE', 'DIESEL', 'GAS']
const ALL_AUTHORS_FILTER = 'all'
const ALL_GASOLINE_FILTER = 'all'
const QUEUE_PAGE_SIZE = 10
const CALL_FILTERS = ['all', 'call', 'contacted', 'no_answer', 'call_later'] as const
const GASOLINE_FUEL_FILTERS = ['AI_92', 'AI_95', 'AI_100'] as const

type CallFilter = (typeof CALL_FILTERS)[number]
type GasolineFuelFilter = typeof ALL_GASOLINE_FILTER | (typeof GASOLINE_FUEL_FILTERS)[number]

type QueueAuthorOption = {
  value: string
  label: string
}

function getInitialVisibleCountByCategory(): Record<FuelQueueCategory, number> {
  return {
    GASOLINE: QUEUE_PAGE_SIZE,
    DIESEL: QUEUE_PAGE_SIZE,
    GAS: QUEUE_PAGE_SIZE,
  }
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  )
}

function formatCreatedBy(row: TodayQueueRow) {
  const roleLabel =
    row.created_by_role && row.created_by_role in ROLE_LABELS
      ? ROLE_LABELS[row.created_by_role as UserRole]
      : 'Пользователь'
  const name = row.created_by_signature_name || row.created_by_full_name

  return name ? `${roleLabel}: ${name}` : 'Автор не указан'
}

function getCreatedByRoleLabel(row: TodayQueueRow) {
  return row.created_by_role && row.created_by_role in ROLE_LABELS
    ? ROLE_LABELS[row.created_by_role as UserRole]
    : 'Пользователь'
}

function getAuthorFilterValue(row: TodayQueueRow) {
  if (row.created_by_profile_id) {
    return row.created_by_profile_id
  }

  return [
    row.created_by_signature_name,
    row.created_by_full_name,
    row.created_by_role,
    'unknown-author',
  ]
    .filter(Boolean)
    .join(':')
}

function getAuthorOptionLabel(row: TodayQueueRow) {
  const name = row.created_by_signature_name || row.created_by_full_name

  return name ? `${name} (${getCreatedByRoleLabel(row)})` : 'Автор не указан'
}

function buildAuthorOptions(rows: TodayQueueRow[]) {
  const options = new Map<string, QueueAuthorOption>()

  rows.forEach((row) => {
    const value = getAuthorFilterValue(row)

    if (!options.has(value)) {
      options.set(value, {
        value,
        label: getAuthorOptionLabel(row),
      })
    }
  })

  return Array.from(options.values()).sort((left, right) =>
    left.label.localeCompare(right.label),
  )
}

function getPhoneHref(phone: string | null) {
  const normalizedPhone = phone?.replace(/[^\d+]/g, '')

  return normalizedPhone ? `tel:${normalizedPhone}` : null
}

const callFilterLabels: Record<CallFilter, string> = {
  call: 'Обзвон',
  all: 'Все',
  contacted: 'Позвонили',
  no_answer: 'Не дозвонились',
  call_later: 'Перезвонить',
}

const callFiltersWithCounters = CALL_FILTERS.filter((filter) => filter !== 'all')

const TODAY_ARRIVALS_LABEL = '\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043f\u0440\u0438\u0435\u0434\u0443\u0442'

function getCallFilterLabel(filter: CallFilter) {
  return filter === 'call' ? TODAY_ARRIVALS_LABEL : callFilterLabels[filter]
}

const callStatusLabels: Record<ReservationCallStatus, string> = {
  NOT_CALLED: 'Не звонили',
  CONTACTED: 'Позвонили',
  NO_ANSWER: 'Не ответил',
  CALL_LATER: 'Перезвонить',
  WRONG_NUMBER: 'Неверный номер',
}

const callStatusBadgeClasses: Record<ReservationCallStatus, string> = {
  NOT_CALLED: 'border-slate-200 bg-slate-50 text-slate-500',
  CONTACTED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  NO_ANSWER: 'border-amber-200 bg-amber-50 text-amber-800',
  CALL_LATER: 'border-sky-200 bg-sky-50 text-sky-700',
  WRONG_NUMBER: 'border-rose-200 bg-rose-50 text-rose-700',
}

const callUnavailableReasonLabels: Record<string, string> = {
  VEHICLE_BLOCKED: 'Автомобиль заблокирован',
  ALREADY_FUELED: 'Автомобиль уже заправлен сегодня',
  ALREADY_CONTACTED: 'Приглашение уже подтверждено оператором',
  NO_OPEN_DAILY_LIMIT: 'Дневной лимит не открыт',
  NO_COMPATIBLE_FUEL: 'Нет подходящей марки топлива',
  OUTSIDE_TODAY_LIMIT: 'Запись пока вне текущего лимита',
  UNKNOWN_OFFLINE_STATUS: 'Нет свежего серверного статуса',
}

const callStatusButtonClasses: Record<ReservationCallStatus, string> = {
  NOT_CALLED:
    'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700',
  CONTACTED:
    'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800',
  NO_ANSWER:
    'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900',
  CALL_LATER: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800',
  WRONG_NUMBER: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800',
}

function getCalledByLabel(row: TodayQueueRow) {
  return row.latest_called_by_signature_name || row.latest_called_by_full_name || 'Пользователь'
}

function isRowCallable(row: TodayQueueRow) {
  return Boolean(row.is_callable_now ?? row.is_within_today_limit)
}

function matchesCallFilter(row: TodayQueueRow, filter: CallFilter) {
  if (filter === 'all') {
    return true
  }

  if (filter === 'call') {
    return isRowCallable(row) && row.latest_call_status !== 'CONTACTED'
  }

  if (filter === 'contacted') {
    return row.latest_call_status === 'CONTACTED'
  }

  if (filter === 'no_answer') {
    return row.latest_call_status === 'NO_ANSWER' || row.latest_call_status === 'WRONG_NUMBER'
  }

  return row.latest_call_status === 'CALL_LATER'
}

function getEffectiveFuelType(row: TodayQueueRow) {
  return row.matched_fuel_type ?? row.fuel_type
}

function matchesGasolineFuelFilter(row: TodayQueueRow, filter: GasolineFuelFilter) {
  return filter === ALL_GASOLINE_FILTER || getEffectiveFuelType(row) === filter
}

function formatCallTime(value: string | null) {
  return value
    ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null
}

function QueueRowCard({
  row,
  isLoggingCall,
  isUpdatingFuelPreference,
  isFuelPreferenceUpdateUnavailable,
  isFuelPreferenceLockedByOpenLimit,
  onLogCall,
  onUpdateFuelPreference,
}: {
  row: TodayQueueRow
  isLoggingCall: boolean
  isUpdatingFuelPreference: boolean
  isFuelPreferenceUpdateUnavailable: boolean
  isFuelPreferenceLockedByOpenLimit: boolean
  onLogCall: (row: TodayQueueRow, status: ReservationCallStatus) => void
  onUpdateFuelPreference: (
    row: TodayQueueRow,
    values: UpdateReservationFuelPreferenceFormValues,
  ) => void
}) {
  const [isFuelDialogOpen, setIsFuelDialogOpen] = useState(false)
  const fuelPreferenceForm = useForm<UpdateReservationFuelPreferenceFormValues>({
    resolver: zodResolver(updateReservationFuelPreferenceSchema),
    mode: 'onBlur',
    defaultValues: {
      fuelType: row.fuel_type as QueueFuelType,
      fuelPreferenceMode: (row.fuel_preference_mode ?? 'EXACT') as FuelPreferenceMode,
    },
  })
  const phoneHref = getPhoneHref(row.driver_phone)
  const callableNow = isRowCallable(row)
  const callActionsDisabled = isLoggingCall || row.is_offline || !callableNow
  const fuelPreferenceActionsDisabled =
    isFuelPreferenceUpdateUnavailable ||
    isFuelPreferenceLockedByOpenLimit ||
    row.is_offline ||
    isUpdatingFuelPreference
  const fuelPreferenceEditLabel = isFuelPreferenceLockedByOpenLimit
    ? 'Топливо нельзя изменить после открытия лимитов на сегодня'
    : 'Изменить марку топлива'
  const isContacted = row.latest_call_status === 'CONTACTED'
  const hasPendingCallSync = row.latest_call_sync_status === 'PENDING'
  const callTime = formatCallTime(row.latest_called_at)
  const quickCallStatus: ReservationCallStatus = isContacted ? 'NOT_CALLED' : 'CONTACTED'
  const phoneActionDisabled = !callableNow
  const matchedFuelLabel = row.matched_fuel_type
    ? (fuelTypeLabels[row.matched_fuel_type as FuelType] ?? row.matched_fuel_type)
    : null
  const callReasonLabel = row.call_unavailable_reason
    ? (callUnavailableReasonLabels[row.call_unavailable_reason] ?? row.call_unavailable_reason)
    : null
  const fuelPreferenceLabel =
    fuelPreferenceLabels[row.fuel_preference_mode as FuelPreferenceMode] ??
    fuelPreferenceLabels.EXACT
  const watchedFuelType = fuelPreferenceForm.watch('fuelType')
  const isGasolineSelected = isGasolineFuelType(watchedFuelType)

  useEffect(() => {
    fuelPreferenceForm.reset({
      fuelType: row.fuel_type as QueueFuelType,
      fuelPreferenceMode: (row.fuel_preference_mode ?? 'EXACT') as FuelPreferenceMode,
    })
  }, [fuelPreferenceForm, row.fuel_preference_mode, row.fuel_type])

  useEffect(() => {
    if (!isGasolineSelected) {
      fuelPreferenceForm.setValue('fuelPreferenceMode', 'EXACT', { shouldValidate: true })
    }
  }, [fuelPreferenceForm, isGasolineSelected])

  function handleFuelPreferenceSubmit(values: UpdateReservationFuelPreferenceFormValues) {
    onUpdateFuelPreference(row, values)
    setIsFuelDialogOpen(false)
  }

  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <Accordion type="single" collapsible>
        <AccordionItem value={row.id} className="border-b-0">
          <div className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-md bg-slate-900 text-white"
                  aria-label={`Текущая позиция ${row.current_position}`}
                >
          
                  <span className="text-sm font-semibold leading-tight">
                    {row.current_position}
                  </span>
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold tracking-normal text-slate-950">
                    {row.normalized_plate_number || 'Номер не загружен'}
                  </h2>
                  <p className="truncate text-xs text-slate-500">
                    {row.driver_full_name || 'Водитель не указан'}
                  </p>
                  <div className="mt-1 flex max-w-full flex-nowrap gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {callableNow ? (
                      <Badge className="h-4 shrink-0 rounded-md bg-emerald-600 px-1.5 text-[11px]">
                        В обзвоне
                      </Badge>
                    ) : row.call_unavailable_reason === 'NO_COMPATIBLE_FUEL' ? (
                      <Badge
                        variant="outline"
                        className="h-4 shrink-0 rounded-md border-amber-200 bg-amber-50 px-1.5 text-[11px] text-amber-800"
                      >
                        Ждёт топливо
                      </Badge>
                    ) : !row.is_within_today_limit ? (
                      <Badge
                        variant="outline"
                        className="h-4 shrink-0 rounded-md border-slate-200 px-1.5 text-[11px] text-slate-600"
                      >
                        Вне лимита
                      </Badge>
                    ) : (
                      <Badge className="h-4 shrink-0 rounded-md px-1.5 text-[11px]">
                        В лимите
                      </Badge>
                    )}
                    {matchedFuelLabel ? (
                      <Badge
                        variant="outline"
                        className="h-4 shrink-0 rounded-md border-emerald-200 bg-emerald-50 px-1.5 text-[11px] text-emerald-700"
                      >
                        {matchedFuelLabel}
                      </Badge>
                    ) : null}
                    {row.latest_call_status && row.latest_call_status !== 'NOT_CALLED' ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-4 shrink-0 rounded-md px-1.5 text-[11px]',
                          callStatusBadgeClasses[row.latest_call_status],
                        )}
                      >
                        {callStatusLabels[row.latest_call_status]}
                      </Badge>
                    ) : null}
                    {hasPendingCallSync ? (
                      <Badge
                        variant="outline"
                        className="h-4 shrink-0 rounded-md border-amber-200 px-1.5 text-[11px] text-amber-700"
                      >
                        Sync
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Дозвонились"
                disabled={callActionsDisabled}
                className={cn(
                  isContacted
                    ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white'
                    : 'border-slate-200 text-slate-400 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700',
                )}
                onClick={() => onLogCall(row, quickCallStatus)}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
              </Button>
              {phoneHref && !phoneActionDisabled ? (
                <Button asChild variant="outline" size="icon" aria-label="Позвонить">
                  <a href={phoneHref}>
                    <Phone className="size-4" aria-hidden="true" />
                  </a>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={phoneHref ? 'Звонок сейчас недоступен' : 'Телефон не указан'}
                  disabled
                >
                  <Phone className="size-4" aria-hidden="true" />
                </Button>
              )}
              <AccordionTrigger
                className="size-8 flex-none justify-center gap-0 p-0 hover:no-underline"
                aria-label="Открыть детали"
              >
                <span className="sr-only">Открыть детали</span>
              </AccordionTrigger>
            </div>
          </div>

          <AccordionContent className="border-t border-slate-100 px-3 pt-3 pb-3">
            <span className="sr-only">Сведения о записи</span>
            <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Номер записи</dt>
                <dd className="font-medium text-slate-950">{row.ticket_number}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Перед вами</dt>
                <dd className="font-medium text-slate-950">{row.people_ahead}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Топливо</dt>
                <dd className="flex items-center gap-2 font-medium text-slate-950">
                  <span>{fuelTypeLabels[row.fuel_type as FuelType] ?? row.fuel_type}</span>
                  <Dialog open={isFuelDialogOpen} onOpenChange={setIsFuelDialogOpen}>
                    <DialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-slate-500 hover:text-slate-900"
                        aria-label={fuelPreferenceEditLabel}
                        title={fuelPreferenceEditLabel}
                        disabled={fuelPreferenceActionsDisabled}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Марка топлива</DialogTitle>
                        <DialogDescription>
                          Номер записи №{row.ticket_number} сохранится без изменения.
                        </DialogDescription>
                      </DialogHeader>
                      <form
                        className="space-y-4"
                        onSubmit={fuelPreferenceForm.handleSubmit(handleFuelPreferenceSubmit)}
                      >
                        <div className="space-y-1.5">
                          <label
                            htmlFor={`fuelType-${row.id}`}
                            className="text-sm font-medium text-slate-700"
                          >
                            Марка топлива
                          </label>
                          <Select
                            value={fuelPreferenceForm.watch('fuelType')}
                            disabled={fuelPreferenceActionsDisabled}
                            onValueChange={(value) =>
                              fuelPreferenceForm.setValue('fuelType', value as QueueFuelType, {
                                shouldDirty: true,
                                shouldValidate: true,
                              })
                            }
                          >
                            <SelectTrigger id={`fuelType-${row.id}`} className="h-10 w-full bg-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper" align="start">
                              {QUEUE_FUEL_TYPES.map((fuelType) => (
                                <SelectItem key={fuelType} value={fuelType}>
                                  {fuelTypeLabels[fuelType]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <label
                            htmlFor={`fuelPreferenceMode-${row.id}`}
                            className="text-sm font-medium text-slate-700"
                          >
                            Предпочтение
                          </label>
                          <Select
                            value={fuelPreferenceForm.watch('fuelPreferenceMode')}
                            disabled={fuelPreferenceActionsDisabled || !isGasolineSelected}
                            onValueChange={(value) =>
                              fuelPreferenceForm.setValue(
                                'fuelPreferenceMode',
                                value as FuelPreferenceMode,
                                {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                },
                              )
                            }
                          >
                            <SelectTrigger
                              id={`fuelPreferenceMode-${row.id}`}
                              className="h-10 w-full bg-white"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper" align="start">
                              <SelectItem value="EXACT">{fuelPreferenceLabels.EXACT}</SelectItem>
                              <SelectItem value="ANY_GASOLINE">
                                {fuelPreferenceLabels.ANY_GASOLINE}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {fuelPreferenceForm.formState.errors.fuelPreferenceMode ? (
                          <p className="text-sm text-red-600">
                            {fuelPreferenceForm.formState.errors.fuelPreferenceMode.message}
                          </p>
                        ) : null}

                        <DialogFooter>
                          <Button
                            type="submit"
                            className="w-full sm:w-auto"
                            disabled={fuelPreferenceActionsDisabled}
                          >
                            {isUpdatingFuelPreference ? 'Сохраняем...' : 'Сохранить'}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Предпочтение</dt>
                <dd className="font-medium text-slate-950">{fuelPreferenceLabel}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Статус по топливу</dt>
                <dd className="font-medium text-slate-950">
                  {callableNow
                    ? 'Можно звонить'
                    : callReasonLabel || 'Ожидает очереди'}
                </dd>
              </div>
              {matchedFuelLabel ? (
                <div>
                  <dt className="text-slate-500">Доступная марка</dt>
                  <dd className="font-medium text-slate-950">{matchedFuelLabel}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-slate-500">Литры</dt>
                <dd className="font-medium text-slate-950">{row.requested_liters} л</dd>
              </div>
              <div>
                <dt className="text-slate-500">Телефон</dt>
                <dd className="font-medium text-slate-950">{row.driver_phone || 'Не указан'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Добавил</dt>
                <dd className="font-medium text-slate-950">{formatCreatedBy(row)}</dd>
              </div>
            </dl>

            {row.comment ? <p className="mt-3 text-sm text-slate-500">{row.comment}</p> : null}

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button
                type="button"
                variant="outline"
                className={cn('gap-2', callStatusButtonClasses.CONTACTED)}
                disabled={callActionsDisabled}
                onClick={() => onLogCall(row, 'CONTACTED')}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Дозвонились
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn('gap-2', callStatusButtonClasses.NO_ANSWER)}
                disabled={callActionsDisabled}
                onClick={() => onLogCall(row, 'NO_ANSWER')}
              >
                <PhoneOff className="size-4" aria-hidden="true" />
                Не ответил
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn('gap-2', callStatusButtonClasses.CALL_LATER)}
                disabled={callActionsDisabled}
                onClick={() => onLogCall(row, 'CALL_LATER')}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Перезвонить
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn('gap-2', callStatusButtonClasses.WRONG_NUMBER)}
                disabled={callActionsDisabled}
                onClick={() => onLogCall(row, 'WRONG_NUMBER')}
              >
                <XCircle className="size-4" aria-hidden="true" />
                Неверный
              </Button>
            </div>

            {row.latest_call_status && row.latest_call_status !== 'NOT_CALLED' ? (
              <p className="mt-3 text-xs text-slate-500">
                Отметил: {getCalledByLabel(row)}
                {callTime ? `, ${callTime}` : ''}
              </p>
            ) : null}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </article>
  )
}

export function TodayQueuePanel() {
  const todayDate = getTodayDateInputValue()
  const [plateSearch, setPlateSearch] = useState('')
  const [authorFilter, setAuthorFilter] = useState(ALL_AUTHORS_FILTER)
  const [gasolineFuelFilter, setGasolineFuelFilter] =
    useState<GasolineFuelFilter>(ALL_GASOLINE_FILTER)
  const [callFilter, setCallFilter] = useState<CallFilter>('all')
  const [visibleCountByCategory, setVisibleCountByCategory] = useState(
    getInitialVisibleCountByCategory,
  )
  const queue = useTodayQueue()
  const dailyLimitOverview = useDailyLimitOverview({ date: todayDate })
  const logReservationCall = useLogReservationCall()
  const updateReservationFuelPreference = useUpdateReservationFuelPreference()
  const isFuelPreferenceLockedByOpenLimit =
    dailyLimitOverview.data?.exists === true && dailyLimitOverview.data.status === 'OPEN'
  const normalizedPlateSearch = normalizePlateNumber(plateSearch)
  const authorOptions = useMemo(() => buildAuthorOptions(queue.rows), [queue.rows])
  const rowsMatchingBaseFilters = useMemo(
    () =>
      queue.rows.filter((row) => {
        const matchesPlate =
          normalizedPlateSearch.length === 0 ||
          row.normalized_plate_number.includes(normalizedPlateSearch)
        const matchesAuthor =
          authorFilter === ALL_AUTHORS_FILTER || getAuthorFilterValue(row) === authorFilter

        return matchesPlate && matchesAuthor
      }),
    [authorFilter, normalizedPlateSearch, queue.rows],
  )
  const filteredRows = useMemo(
    () =>
      rowsMatchingBaseFilters.filter((row) => {
        const matchesCall = matchesCallFilter(row, callFilter)

        return matchesCall
      }),
    [callFilter, rowsMatchingBaseFilters],
  )
  const callRowsCount = rowsMatchingBaseFilters.filter((row) => matchesCallFilter(row, 'call')).length
  const contactedRowsCount = rowsMatchingBaseFilters.filter(
    (row) => row.latest_call_status === 'CONTACTED',
  ).length
  const callFilterCounts = useMemo(
    () =>
      Object.fromEntries(
        callFiltersWithCounters.map((filter) => [
          filter,
          rowsMatchingBaseFilters.filter((row) => matchesCallFilter(row, filter)).length,
        ]),
      ) as Record<(typeof callFiltersWithCounters)[number], number>,
    [rowsMatchingBaseFilters],
  )
  const rowsByCategory = categoryOrder.map((fuelCategory) => ({
    fuelCategory,
    rows: filteredRows.filter((row) => {
      const matchesCategory = getFuelQueueCategory(row.fuel_type) === fuelCategory

      if (fuelCategory !== 'GASOLINE') {
        return matchesCategory
      }

      return matchesCategory && matchesGasolineFuelFilter(row, gasolineFuelFilter)
    }),
  }))
  const visibleRowsCount = rowsByCategory.reduce((count, category) => count + category.rows.length, 0)
  const hasActiveFilters =
    normalizedPlateSearch.length > 0 ||
    authorFilter !== ALL_AUTHORS_FILTER ||
    gasolineFuelFilter !== ALL_GASOLINE_FILTER ||
    callFilter !== 'all'

  useEffect(() => {
    setVisibleCountByCategory(getInitialVisibleCountByCategory())
  }, [authorFilter, callFilter, gasolineFuelFilter, normalizedPlateSearch])

  function showMoreRows(fuelCategory: FuelQueueCategory) {
    setVisibleCountByCategory((current) => ({
      ...current,
      [fuelCategory]: current[fuelCategory] + QUEUE_PAGE_SIZE,
    }))
  }

  function handleLogCall(row: TodayQueueRow, status: ReservationCallStatus) {
    logReservationCall.mutate({ reservation: row, status })
  }

  function handleUpdateFuelPreference(
    row: TodayQueueRow,
    values: UpdateReservationFuelPreferenceFormValues,
  ) {
    updateReservationFuelPreference.mutate({
      reservationId: row.id,
      fuelType: values.fuelType,
      fuelPreferenceMode: values.fuelPreferenceMode,
      clientMutationId: crypto.randomUUID(),
    })
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-5 text-slate-500" aria-hidden="true" />
            Общая очередь
          </CardTitle>
          <CardDescription>
            Единая очередь по всем АЗС, разложенная на бензин, дизель и газ.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!queue.isOnline ? (
            <Alert className="border-amber-200 bg-amber-50 text-amber-950">
              <CloudOff className="size-4" aria-hidden="true" />
              <AlertTitle>Offline-режим</AlertTitle>
              <AlertDescription>
                Показан локальный снимок. Новые отметки обзвона будут подтверждены после
                синхронизации.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <SummaryTile label={'\u0412\u0441\u0435\u0433\u043e'} value={visibleRowsCount} />
            <SummaryTile label="Обзвон" value={callRowsCount} />
            <SummaryTile label="Позвонили" value={contactedRowsCount} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="queueCallFilter" className="text-sm font-medium text-slate-700">
                Обзвон
              </label>
              <Select
                value={callFilter}
                onValueChange={(value) => setCallFilter(value as CallFilter)}
              >
                <SelectTrigger
                  id="queueCallFilter"
                  className="h-8 w-full [&_[data-call-filter-count]]:hidden"
                >
                  <SelectValue placeholder="Все" />
                </SelectTrigger>
                <SelectContent>
                  {CALL_FILTERS.map((filter) => (
                    <SelectItem key={filter} value={filter} textValue={getCallFilterLabel(filter)}>
                      {filter === 'all' ? (
                        getCallFilterLabel(filter)
                      ) : (
                        <span className="flex w-full items-center justify-between gap-3">
                          <span>{getCallFilterLabel(filter)}</span>
                          <span
                            data-call-filter-count
                            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700"
                          >
                            {callFilterCounts[filter]}
                          </span>
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="queuePlateSearch" className="text-sm font-medium text-slate-700">
                Поиск по госномеру
              </label>
              <Input
                id="queuePlateSearch"
                value={plateSearch}
                onChange={(event) => setPlateSearch(event.target.value)}
                placeholder="А123ВС777"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="queueGasolineFuelFilter"
                className="text-sm font-medium text-slate-700"
              >
                {'\u041c\u0430\u0440\u043a\u0430 \u0431\u0435\u043d\u0437\u0438\u043d\u0430'}
              </label>
              <Select
                value={gasolineFuelFilter}
                onValueChange={(value) => setGasolineFuelFilter(value as GasolineFuelFilter)}
              >
                <SelectTrigger id="queueGasolineFuelFilter" className="h-8 w-full">
                  <SelectValue
                    placeholder={'\u0412\u0441\u0435 \u043c\u0430\u0440\u043a\u0438'}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_GASOLINE_FILTER}>
                    {'\u0412\u0441\u0435 \u043c\u0430\u0440\u043a\u0438'}
                  </SelectItem>
                  {GASOLINE_FUEL_FILTERS.map((fuelType) => (
                    <SelectItem key={fuelType} value={fuelType}>
                      {fuelTypeLabels[fuelType]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="queueAuthorFilter" className="text-sm font-medium text-slate-700">
                Кто добавил
              </label>
              <Select value={authorFilter} onValueChange={setAuthorFilter}>
                <SelectTrigger id="queueAuthorFilter" className="h-8 w-full">
                  <SelectValue placeholder="Все авторы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_AUTHORS_FILTER}>Все авторы</SelectItem>
                  {authorOptions.map((author) => (
                    <SelectItem key={author.value} value={author.value}>
                      {author.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {queue.error ? (
        <Alert variant="destructive">
          <AlertTitle>Очередь не загружена</AlertTitle>
          <AlertDescription>{queue.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {logReservationCall.error ? (
        <Alert variant="destructive">
          <AlertTitle>Отметка звонка не сохранена</AlertTitle>
          <AlertDescription>{logReservationCall.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {updateReservationFuelPreference.error ? (
        <Alert variant="destructive">
          <AlertTitle>Марка топлива не сохранена</AlertTitle>
          <AlertDescription>{updateReservationFuelPreference.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {queue.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Загрузка очереди...
        </div>
      ) : null}

      {!queue.isLoading && queue.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          В общей очереди нет активных записей.
        </div>
      ) : null}

      {!queue.isLoading &&
      queue.rows.length > 0 &&
      visibleRowsCount === 0 &&
      hasActiveFilters ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          По выбранным фильтрам записей нет.
        </div>
      ) : null}

      {visibleRowsCount > 0 ? (
        <Tabs defaultValue="GASOLINE" className="space-y-3">
          <TabsList className="grid w-full grid-cols-3">
            {rowsByCategory.map(({ fuelCategory, rows }) => (
              <TabsTrigger key={fuelCategory} value={fuelCategory}>
                {categoryLabels[fuelCategory]} ({rows.length})
              </TabsTrigger>
            ))}
          </TabsList>
          {rowsByCategory.map(({ fuelCategory, rows }) => {
            const visibleCount = visibleCountByCategory[fuelCategory]
            const visibleRows = rows.slice(0, visibleCount)
            const hasMoreRows = rows.length > visibleCount

            return (
              <TabsContent key={fuelCategory} value={fuelCategory} className="space-y-3">
                {rows.length > 0 ? (
                  <>
                    {visibleRows.map((row) => (
                      <QueueRowCard
                        key={row.id}
                        row={row}
                        isLoggingCall={logReservationCall.isPending}
                        isUpdatingFuelPreference={
                          updateReservationFuelPreference.isPending &&
                          updateReservationFuelPreference.variables?.reservationId === row.id
                        }
                        isFuelPreferenceUpdateUnavailable={!queue.isOnline}
                        isFuelPreferenceLockedByOpenLimit={isFuelPreferenceLockedByOpenLimit}
                        onLogCall={handleLogCall}
                        onUpdateFuelPreference={handleUpdateFuelPreference}
                      />
                    ))}
                    {hasMoreRows ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => showMoreRows(fuelCategory)}
                      >
                        Показать еще
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                    В этой очереди нет активных записей.
                  </div>
                )}
              </TabsContent>
            )
          })}
        </Tabs>
      ) : null}
    </div>
  )
}
