import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'

import {
  CheckCircle2,
  MapPin,
  Pencil,
  Phone,
  PhoneOff,
  Trash2,
} from 'lucide-react'

import type { TodayQueueRow } from '@/entities/reservation'
import {
  cancelReservationSchema,
  type CancelReservationFormValues,
} from '@/features/cancel-reservation'
import {
  type UpdateReservationFuelPreferenceFormValues,
  updateReservationFuelPreferenceSchema,
} from '@/features/update-reservation-fuel-preference'
import {
  isGasolineFuelType,
  type FuelPreferenceMode,
  type FuelType,
  type QueueFuelType,
  QUEUE_FUEL_TYPES,
  getFuelQueueCategory,
  type ReservationCallStatus,
} from '@/shared/constants'
import { cn } from '@/shared/lib/utils'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/shared/ui/accordion'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
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

import {
  callStatusBadgeClasses,
  callStatusButtonClasses,
  callStatusLabels,
  callUnavailableReasonLabels,
  categoryLabels,
  fuelPreferenceLabels,
  fuelTypeLabels,
} from '../model/labels'
import {
  formatCallTime,
  formatCreatedBy,
  getCalledByLabel,
  getPhoneHref,
} from '../model/format'
import { isRowCallable } from '../model/queue-model'

type QueueRowCardProps = {
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
}

export function QueueRowCard({
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
}: QueueRowCardProps) {
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
  const stationLabel = row.station_name ?? 'АЗС будет назначена'
  const matchedFuelLabel = row.matched_fuel_type
    ? (fuelTypeLabels[row.matched_fuel_type as FuelType] ?? row.matched_fuel_type)
    : null
  const fuelCategory = getFuelQueueCategory(row.fuel_type)
  const fuelCategoryLabel = fuelCategory ? categoryLabels[fuelCategory].toLowerCase() : 'топлива'
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
                  aria-label={`Позиция в очереди топлива ${row.current_position}`}
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
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    В очереди {fuelCategoryLabel}: {row.current_position} · Талон №{row.ticket_number}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                    <MapPin className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{stationLabel}</span>
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
                <dt className="text-slate-500">АЗС</dt>
                <dd className="font-medium text-slate-950">{stationLabel}</dd>
                {row.station_address ? (
                  <dd className="text-xs text-slate-500">{row.station_address}</dd>
                ) : null}
              </div>
              <div>
                <dt className="text-slate-500">Позиция в очереди топлива</dt>
                <dd className="font-medium text-slate-950">{row.current_position}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Номер талона</dt>
                <dd className="font-medium text-slate-950">№{row.ticket_number}</dd>
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
                  {callableNow ? 'Можно звонить' : callReasonLabel || 'Ожидает очереди'}
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

            <div className="mt-3 grid grid-cols-2 gap-2">
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
