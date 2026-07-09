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
  Trash2,
  XCircle,
} from 'lucide-react'

import { useDailyLimitOverview } from '@/entities/daily-limit'
import { useCurrentProfile } from '@/entities/profile'
import {
  useTodayQueue,
  useTodayQueueAuthors,
  type TodayQueueRow,
} from '@/entities/reservation'
import {
  cancelReservationSchema,
  type CancelReservationFormValues,
  useCancelReservation,
} from '@/features/cancel-reservation'
import { useLogReservationCall } from '@/features/log-reservation-call'
import { useDailyFuelingSchedule } from '@/features/manage-fueling-schedule'
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
import {
  buildFuelingScheduleEta,
  buildFuelingScheduleSummary,
  type FuelingScheduleConfig,
  type FuelingScheduleSummary,
} from '@/shared/lib/fueling-schedule'
import { canCancelReservation } from '@/shared/lib/permissions'
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
const CALL_FILTERS = ['all', 'call', 'contacted', 'no_answer', 'call_later'] as const
const GASOLINE_FUEL_FILTERS = ['AI_92', 'AI_95', 'AI_100'] as const

type CallFilter = (typeof CALL_FILTERS)[number]
type GasolineFuelFilter = typeof ALL_GASOLINE_FILTER | (typeof GASOLINE_FUEL_FILTERS)[number]

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  )
}

function FuelingScheduleSummaryPanel({ summaries }: { summaries: FuelingScheduleSummary[] }) {
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

function formatCreatedBy(row: TodayQueueRow) {
  const roleLabel =
    row.created_by_role && row.created_by_role in ROLE_LABELS
      ? ROLE_LABELS[row.created_by_role as UserRole]
      : 'Пользователь'
  const name = row.created_by_signature_name || row.created_by_full_name

  return name ? `${roleLabel}: ${name}` : 'Автор не указан'
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

function hasActiveGasolineLimit(
  categoryOverviews:
    | NonNullable<ReturnType<typeof useDailyLimitOverview>['data']>['category_overviews']
    | undefined,
) {
  const gasolineOverview = categoryOverviews?.find((row) => row.fuel_category === 'GASOLINE')

  if (!gasolineOverview) {
    return false
  }

  if (gasolineOverview.limit_mode === 'fuel_liters') {
    return (gasolineOverview.liters_limit ?? 0) > 0
  }

  return gasolineOverview.vehicle_limit > 0
}

function formatCallTime(value: string | null) {
  return value
    ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null
}

function QueueRowCard({
  row,
  estimatedArrivalTime,
  isLoggingCall,
  isUpdatingFuelPreference,
  isFuelPreferenceUpdateUnavailable,
  isFuelPreferenceLockedByGasolineLimit,
  canCancel,
  isCancelling,
  onLogCall,
  onUpdateFuelPreference,
  onCancel,
}: {
  row: TodayQueueRow
  estimatedArrivalTime: string | null
  isLoggingCall: boolean
  isUpdatingFuelPreference: boolean
  isFuelPreferenceUpdateUnavailable: boolean
  isFuelPreferenceLockedByGasolineLimit: boolean
  canCancel: boolean
  isCancelling: boolean
  onLogCall: (row: TodayQueueRow, status: ReservationCallStatus) => void
  onUpdateFuelPreference: (
    row: TodayQueueRow,
    values: UpdateReservationFuelPreferenceFormValues,
  ) => void
  onCancel: (row: TodayQueueRow, values: CancelReservationFormValues) => void
}) {
  const [isFuelDialogOpen, setIsFuelDialogOpen] = useState(false)
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false)
  const fuelPreferenceForm = useForm<UpdateReservationFuelPreferenceFormValues>({
    resolver: zodResolver(updateReservationFuelPreferenceSchema),
    mode: 'onBlur',
    defaultValues: {
      fuelType: row.fuel_type as QueueFuelType,
      fuelPreferenceMode: (row.fuel_preference_mode ?? 'EXACT') as FuelPreferenceMode,
    },
  })
  const cancelForm = useForm<CancelReservationFormValues>({
    resolver: zodResolver(cancelReservationSchema),
    mode: 'onBlur',
    defaultValues: {
      reason: 'OWNER_CANCELLED',
      comment: '',
    },
  })
  const phoneHref = getPhoneHref(row.driver_phone)
  const callableNow = isRowCallable(row)
  const isContacted = row.latest_call_status === 'CONTACTED'
  const canResetContacted = isContacted
  const callActionsDisabled = isLoggingCall || row.is_offline || !callableNow
  const contactedActionDisabled =
    isLoggingCall || row.is_offline || (!callableNow && !canResetContacted)
  const fuelPreferenceActionsDisabled =
    isFuelPreferenceUpdateUnavailable ||
    isFuelPreferenceLockedByGasolineLimit ||
    row.is_offline ||
    isUpdatingFuelPreference
  const fuelPreferenceEditLabel = isFuelPreferenceLockedByGasolineLimit
    ? 'Топливо нельзя изменить, пока по бензину установлен ненулевой лимит'
    : 'Изменить марку топлива'
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
  const watchedCancelReason = cancelForm.watch('reason')
  const isGasolineSelected = isGasolineFuelType(watchedFuelType)
  const cancelActionDisabled = row.is_offline || isCancelling

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

  useEffect(() => {
    if (watchedCancelReason !== 'OTHER') {
      cancelForm.setValue('comment', '', { shouldValidate: true })
    }
  }, [cancelForm, watchedCancelReason])

  function handleFuelPreferenceSubmit(values: UpdateReservationFuelPreferenceFormValues) {
    onUpdateFuelPreference(row, values)
    setIsFuelDialogOpen(false)
  }

  function handleCancelSubmit(values: CancelReservationFormValues) {
    onCancel(row, values)
    setIsCancelDialogOpen(false)
    cancelForm.reset({ reason: 'OWNER_CANCELLED', comment: '' })
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
                  {estimatedArrivalTime ? (
                    <p className="mt-0.5 truncate text-xs font-medium text-slate-700">
                      Предполагаемое время прибытия: {estimatedArrivalTime}
                    </p>
                  ) : null}
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
                disabled={contactedActionDisabled}
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
              {canCancel ? (
                <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
                      aria-label="Удалить из очереди"
                      disabled={cancelActionDisabled}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Удалить из очереди?</DialogTitle>
                      <DialogDescription>
                        Запись №{row.ticket_number} исчезнет из активной очереди, но останется в истории удалений.
                      </DialogDescription>
                    </DialogHeader>
                    <form
                      className="space-y-4"
                      onSubmit={cancelForm.handleSubmit(handleCancelSubmit)}
                    >
                      <fieldset className="space-y-2">
                        <legend className="text-sm font-medium text-slate-800">
                          Причина удаления
                        </legend>
                        <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
                          <input
                            type="radio"
                            className="mt-1"
                            value="OWNER_CANCELLED"
                            {...cancelForm.register('reason')}
                          />
                          <span>Отменено владельцем машины</span>
                        </label>
                        <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
                          <input
                            type="radio"
                            className="mt-1"
                            value="OTHER"
                            {...cancelForm.register('reason')}
                          />
                          <span>Другое</span>
                        </label>
                      </fieldset>

                      {watchedCancelReason === 'OTHER' ? (
                        <div className="space-y-1.5">
                          <label
                            htmlFor={`cancelComment-${row.id}`}
                            className="text-sm font-medium text-slate-700"
                          >
                            Что случилось
                          </label>
                          <Input
                            id={`cancelComment-${row.id}`}
                            placeholder="Например: дубль, ошибка в данных"
                            {...cancelForm.register('comment')}
                          />
                          {cancelForm.formState.errors.comment ? (
                            <p className="text-sm text-red-600">
                              {cancelForm.formState.errors.comment.message}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      <DialogFooter>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIsCancelDialogOpen(false)}
                        >
                          Не удалять
                        </Button>
                        <Button
                          type="submit"
                          className="bg-rose-600 text-white hover:bg-rose-700"
                          disabled={cancelActionDisabled}
                        >
                          {isCancelling ? 'Удаляем...' : 'Удалить'}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              ) : null}
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
              {estimatedArrivalTime ? (
                <div>
                  <dt className="text-slate-500">Предполагаемое время прибытия</dt>
                  <dd className="font-medium text-slate-950">{estimatedArrivalTime}</dd>
                </div>
              ) : null}
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
                disabled={contactedActionDisabled}
                onClick={() => onLogCall(row, quickCallStatus)}
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
  const currentProfileQuery = useCurrentProfile()
  const queue = useTodayQueue({
    plateSearch,
    createdByProfileId: authorFilter === ALL_AUTHORS_FILTER ? null : authorFilter,
    callFilter,
    gasolineFuelFilter,
  })
  const authorsQuery = useTodayQueueAuthors({
    plateSearch,
    callFilter,
    gasolineFuelFilter,
  })
  const dailyLimitOverview = useDailyLimitOverview({ date: todayDate })
  const fuelingSchedule = useDailyFuelingSchedule(todayDate)
  const logReservationCall = useLogReservationCall()
  const updateReservationFuelPreference = useUpdateReservationFuelPreference()
  const cancelReservation = useCancelReservation()
  const currentRole = currentProfileQuery.data?.role
  const canCancelQueueRows = currentRole ? canCancelReservation(currentRole) : false
  const isFuelPreferenceLockedByGasolineLimit = hasActiveGasolineLimit(
    dailyLimitOverview.data?.category_overviews,
  )
  const normalizedPlateSearch = normalizePlateNumber(plateSearch)
  const authorOptions = authorsQuery.data ?? []
  const scheduleConfigs = useMemo(
    () =>
      (fuelingSchedule.data ?? []).map(
        (row): FuelingScheduleConfig => ({
          fuelCategory: row.fuel_category,
          startTime: row.start_time,
          intervalMinutes: row.interval_minutes,
          vehiclesPerInterval: row.vehicles_per_interval,
        }),
      ),
    [fuelingSchedule.data],
  )
  const fuelingScheduleRows = useMemo(
    () =>
      queue.rows
        .filter(isRowCallable)
        .map((row) => ({
          id: row.id,
          ticketNumber: row.ticket_number,
          fuelCategory: getFuelQueueCategory(row.fuel_type),
        })),
    [queue.rows],
  )
  const etaByReservationId = useMemo(
    () => buildFuelingScheduleEta(fuelingScheduleRows, scheduleConfigs),
    [fuelingScheduleRows, scheduleConfigs],
  )
  const fuelingScheduleSummaries = useMemo(
    () => buildFuelingScheduleSummary(fuelingScheduleRows, scheduleConfigs, categoryOrder),
    [fuelingScheduleRows, scheduleConfigs],
  )
  const rowsMatchingBaseFilters = queue.rows
  const filteredRows = queue.rows
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
    rows: filteredRows.filter((row) => getFuelQueueCategory(row.fuel_type) === fuelCategory),
  }))
  const visibleRowsCount = rowsByCategory.reduce((count, category) => count + category.rows.length, 0)
  const hasActiveFilters =
    normalizedPlateSearch.length > 0 ||
    authorFilter !== ALL_AUTHORS_FILTER ||
    gasolineFuelFilter !== ALL_GASOLINE_FILTER ||
    callFilter !== 'all'

  useEffect(() => {
    if (
      authorFilter !== ALL_AUTHORS_FILTER &&
      authorsQuery.data &&
      !authorsQuery.data.some((author) => author.userId === authorFilter)
    ) {
      setAuthorFilter(ALL_AUTHORS_FILTER)
    }
  }, [authorFilter, authorsQuery.data])

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

  function handleCancelReservation(row: TodayQueueRow, values: CancelReservationFormValues) {
    cancelReservation.mutate({
      reservationId: row.id,
      reason: values.reason,
      comment: values.reason === 'OTHER' ? (values.comment ?? '').trim() : null,
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

          <FuelingScheduleSummaryPanel summaries={fuelingScheduleSummaries} />

          {fuelingSchedule.error ? (
            <Alert variant="destructive">
              <AlertTitle>Расписание розлива не загружено</AlertTitle>
              <AlertDescription>{fuelingSchedule.error.message}</AlertDescription>
            </Alert>
          ) : null}

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
                    <SelectItem key={author.userId} value={author.userId}>
                      {author.displayName}
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

      {authorsQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Авторы очереди не загружены</AlertTitle>
          <AlertDescription>{authorsQuery.error.message}</AlertDescription>
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

      {cancelReservation.error ? (
        <Alert variant="destructive">
          <AlertTitle>Запись не удалена</AlertTitle>
          <AlertDescription>{cancelReservation.error.message}</AlertDescription>
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
            return (
              <TabsContent key={fuelCategory} value={fuelCategory} className="space-y-3">
                {rows.length > 0 ? (
                  <>
                    {rows.map((row) => (
                      <QueueRowCard
                        key={row.id}
                        row={row}
                        estimatedArrivalTime={
                          etaByReservationId.get(row.id)?.arrivalTime ?? null
                        }
                        isLoggingCall={logReservationCall.isPending}
                        isUpdatingFuelPreference={
                          updateReservationFuelPreference.isPending &&
                          updateReservationFuelPreference.variables?.reservationId === row.id
                        }
                        isFuelPreferenceUpdateUnavailable={!queue.isOnline}
                        isFuelPreferenceLockedByGasolineLimit={
                          isFuelPreferenceLockedByGasolineLimit
                        }
                        canCancel={canCancelQueueRows}
                        isCancelling={
                          cancelReservation.isPending &&
                          cancelReservation.variables?.reservationId === row.id
                        }
                        onLogCall={handleLogCall}
                        onUpdateFuelPreference={handleUpdateFuelPreference}
                        onCancel={handleCancelReservation}
                      />
                    ))}
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

      {visibleRowsCount > 0 && queue.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={queue.isFetchingNextPage}
          onClick={() => void queue.fetchNextPage()}
        >
          {queue.isFetchingNextPage ? 'Загружаем...' : 'Показать еще'}
        </Button>
      ) : null}
    </div>
  )
}
