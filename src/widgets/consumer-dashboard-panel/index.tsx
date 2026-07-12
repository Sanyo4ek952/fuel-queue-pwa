import { zodResolver } from '@hookform/resolvers/zod'
import {
  AlertTriangle,
  Car,
  Clock,
  MapPin,
  Pencil,
  RefreshCw,
  Ticket,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'

import { useCancelConsumerReservation } from '@/features/cancel-consumer-reservation'
import {
  CreateConsumerReservationForm,
  useMyTodayFuelingStatus,
  useMyQueueStatus,
} from '@/features/create-consumer-reservation'
import {
  AddConsumerVehicleForm,
  type ConsumerVehicle,
  useConsumerVehicles,
  useUnlinkConsumerVehicle,
} from '@/features/manage-consumer-vehicles'
import {
  type UpdateReservationFuelPreferenceFormValues,
  updateReservationFuelPreferenceSchema,
  useUpdateReservationFuelPreference,
} from '@/features/update-reservation-fuel-preference'
import {
  QUEUE_FUEL_TYPES,
  isGasolineFuelType,
  type FuelPreferenceMode,
  type FuelType,
  type QueueFuelType,
} from '@/shared/constants'
import { getConsumerCabinetErrorMessage } from '@/shared/lib/consumer-cabinet-error'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

const reservationStatusLabels = {
  WAITING: 'В постоянной очереди',
  RESERVED: 'В очереди',
  ARRIVED: 'Прибыл',
  APPROVED: 'Допущен',
  FUELING: 'Заправляется',
  FUELED: 'Заправлено',
  REJECTED: 'Отказано',
  CANCELLED: 'Отменено',
  NO_SHOW: 'Неявка',
  EXPIRED: 'Просрочено',
  ERROR: 'Ошибка',
  CONFLICT: 'Конфликт',
} as const

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
  ANY_GASOLINE: 'Подойдет АИ-92/95/100',
}

function getLimitStatusView(isWithinTodayLimit: boolean | null | undefined) {
  if (isWithinTodayLimit === true) {
    return {
      label: 'В лимите',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50',
    }
  }

  if (isWithinTodayLimit === false) {
    return {
      label: 'Вне лимита',
      className: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50',
    }
  }

  return {
    label: 'Уточняется',
    className: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-50',
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function ConsumerDashboardPanel() {
  const vehiclesQuery = useConsumerVehicles()
  const queueStatusQuery = useMyQueueStatus()
  const todayFuelingStatusQuery = useMyTodayFuelingStatus()
  const cancelReservationMutation = useCancelConsumerReservation()
  const updateFuelPreferenceMutation = useUpdateReservationFuelPreference()
  const unlinkVehicleMutation = useUnlinkConsumerVehicle()
  const [isFuelDialogOpen, setIsFuelDialogOpen] = useState(false)
  const [selectedUnlinkVehicle, setSelectedUnlinkVehicle] = useState<ConsumerVehicle | null>(null)
  const vehicles = vehiclesQuery.data ?? []
  const activeReservation = queueStatusQuery.data
  const todayFuelingStatus = todayFuelingStatusQuery.data
  const canAddVehicle = vehicles.length < 3
  const canCreateReservation =
    vehicles.length > 0 && !activeReservation && !todayFuelingStatus && !queueStatusQuery.error
  const canCancelReservation =
    activeReservation?.status === 'WAITING' || activeReservation?.status === 'RESERVED'
  const isFuelPreferenceUpdateLocked =
    activeReservation?.is_fuel_preference_update_locked === true
  const canEditFuelPreference =
    Boolean(activeReservation) &&
    !isFuelPreferenceUpdateLocked &&
    !updateFuelPreferenceMutation.isPending
  const matchedFuelLabel = activeReservation?.matched_fuel_type
    ? (fuelTypeLabels[activeReservation.matched_fuel_type] ?? activeReservation.matched_fuel_type)
    : null
  const stationLabel =
    activeReservation?.allocation?.station_name ??
    activeReservation?.station_name ??
    'Ожидает дневного распределения'
  const stationAddress =
    activeReservation?.allocation?.station_address ?? activeReservation?.station_address
  const limitStatusView = getLimitStatusView(activeReservation?.is_within_today_limit)
  const hasDailyDistribution =
    Boolean(activeReservation?.allocation) ||
    Boolean(activeReservation?.station_name) ||
    activeReservation?.is_within_today_limit != null ||
    Boolean(activeReservation?.matched_fuel_type)
  const fuelQueuePosition =
    activeReservation?.fuel_queue_position ?? activeReservation?.current_position
  const fuelQueuePositionLabel = fuelQueuePosition
    ? `№${fuelQueuePosition}`
    : 'Ожидает расчёта'
  const fuelPreferenceForm = useForm<UpdateReservationFuelPreferenceFormValues>({
    resolver: zodResolver(updateReservationFuelPreferenceSchema),
    mode: 'onBlur',
    defaultValues: {
      fuelType: (activeReservation?.fuel_type ?? 'AI_95') as QueueFuelType,
      fuelPreferenceMode: (activeReservation?.fuel_preference_mode ?? 'EXACT') as FuelPreferenceMode,
    },
  })
  const watchedFuelType = fuelPreferenceForm.watch('fuelType')
  const isGasolineSelected = isGasolineFuelType(watchedFuelType)
  const estimatedArrivalTime = activeReservation?.allocation?.arrival_at
    ? new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow',
      }).format(new Date(activeReservation.allocation.arrival_at))
    : null

  function refresh() {
    void vehiclesQuery.refetch()
    void queueStatusQuery.refetch()
    void todayFuelingStatusQuery.refetch()
  }

  function handleFuelPreferenceSubmit(values: UpdateReservationFuelPreferenceFormValues) {
    if (!activeReservation || isFuelPreferenceUpdateLocked) {
      return
    }

    updateFuelPreferenceMutation.mutate(
      {
        reservationId: activeReservation.id,
        fuelType: values.fuelType,
        fuelPreferenceMode: values.fuelPreferenceMode,
        clientMutationId: crypto.randomUUID(),
      },
      {
        onSuccess: () => {
          setIsFuelDialogOpen(false)
          void queueStatusQuery.refetch()
        },
      },
    )
  }

  function handleUnlinkVehicle() {
    if (!selectedUnlinkVehicle) {
      return
    }

    unlinkVehicleMutation.mutate(
      {
        profileVehicleId: selectedUnlinkVehicle.profile_vehicle_id,
        clientMutationId: crypto.randomUUID(),
      },
      {
        onSuccess: () => {
          setSelectedUnlinkVehicle(null)
        },
      },
    )
  }

  useEffect(() => {
    if (!activeReservation) {
      return
    }

    fuelPreferenceForm.reset({
      fuelType: activeReservation.fuel_type as QueueFuelType,
      fuelPreferenceMode: (activeReservation.fuel_preference_mode ?? 'EXACT') as FuelPreferenceMode,
    })
  }, [activeReservation, fuelPreferenceForm])

  useEffect(() => {
    if (!isGasolineSelected) {
      fuelPreferenceForm.setValue('fuelPreferenceMode', 'EXACT', { shouldValidate: true })
    }
  }, [fuelPreferenceForm, isGasolineSelected])

  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-slate-950 p-5 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-300">Кабинет жителя</p>
            <h1 className="mt-2 text-2xl font-semibold">Моя очередь на топливо</h1>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            disabled={vehiclesQuery.isFetching || queueStatusQuery.isFetching}
            onClick={refresh}
            title="Обновить"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Badge className="rounded-md bg-white text-slate-950 hover:bg-white">
            {vehicles.length}/3 авто
          </Badge>
          <Badge
            variant="outline"
            className="rounded-md border-white/20 bg-white/10 text-white hover:bg-white/10"
          >
            {activeReservation ? 'Есть активная запись' : 'Нет активной записи'}
          </Badge>
        </div>
      </section>

      {queueStatusQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить очередь</AlertTitle>
          <AlertDescription>
            {getConsumerCabinetErrorMessage(
              queueStatusQuery.error,
              'Не удалось загрузить очередь.',
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {vehiclesQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить автомобили</AlertTitle>
          <AlertDescription>
            {getConsumerCabinetErrorMessage(
              vehiclesQuery.error,
              'Не удалось загрузить автомобили.',
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {todayFuelingStatusQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить сегодняшнюю заправку</AlertTitle>
          <AlertDescription>
            {getConsumerCabinetErrorMessage(
              todayFuelingStatusQuery.error,
              'Не удалось загрузить сегодняшнюю заправку.',
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {activeReservation ? (
        <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ticket className="size-5 text-slate-500" aria-hidden="true" />
              Активная запись
            </CardTitle>
            <CardDescription>
              Постоянный номер в общей очереди №{activeReservation.permanent_number}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-slate-500">Автомобиль в очереди</span>
                <p className="font-medium text-slate-950">
                  {activeReservation.normalized_plate_number}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Статус</span>
                <p className="font-medium text-slate-950">
                  {reservationStatusLabels[activeReservation.status]}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Общая очередь</span>
                <p className="font-medium text-slate-950">№{activeReservation.permanent_number}</p>
              </div>
              <div>
                <span className="text-slate-500">Топливо</span>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-950">
                    {fuelTypeLabels[activeReservation.fuel_type] ?? activeReservation.fuel_type}
                  </p>
                  <Dialog open={isFuelDialogOpen} onOpenChange={setIsFuelDialogOpen}>
                    <DialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-slate-500 hover:text-slate-900"
                        disabled={!canEditFuelPreference}
                        title="Изменить марку топлива"
                        aria-label="Изменить марку топлива"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Марка топлива</DialogTitle>
                        <DialogDescription>
                          Постоянный номер в общей очереди №{activeReservation.permanent_number}{' '}
                          сохранится без изменения.
                        </DialogDescription>
                      </DialogHeader>
                      <Form {...fuelPreferenceForm}>
                        <form
                          className="space-y-4"
                          onSubmit={fuelPreferenceForm.handleSubmit(handleFuelPreferenceSubmit)}
                        >
                          <FormItem>
                            <FormLabel htmlFor="consumerReservationFuelType">
                              Марка топлива
                            </FormLabel>
                            <Select
                              value={fuelPreferenceForm.watch('fuelType')}
                              disabled={!canEditFuelPreference}
                              onValueChange={(value) =>
                                fuelPreferenceForm.setValue('fuelType', value as QueueFuelType, {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                })
                              }
                            >
                              <SelectTrigger
                                id="consumerReservationFuelType"
                                className="h-10 w-full bg-white"
                              >
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
                            {fuelPreferenceForm.formState.errors.fuelType ? (
                              <FormMessage>
                                {fuelPreferenceForm.formState.errors.fuelType.message}
                              </FormMessage>
                            ) : null}
                          </FormItem>

                          <FormItem>
                            <FormLabel htmlFor="consumerReservationFuelPreferenceMode">
                              Предпочтение
                            </FormLabel>
                            <Select
                              value={fuelPreferenceForm.watch('fuelPreferenceMode')}
                              disabled={!canEditFuelPreference || !isGasolineSelected}
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
                                id="consumerReservationFuelPreferenceMode"
                                className="h-10 w-full bg-white"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent position="popper" align="start">
                                <SelectItem value="EXACT">
                                  {fuelPreferenceLabels.EXACT}
                                </SelectItem>
                                <SelectItem value="ANY_GASOLINE">
                                  {fuelPreferenceLabels.ANY_GASOLINE}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            {fuelPreferenceForm.formState.errors.fuelPreferenceMode ? (
                              <FormMessage>
                                {fuelPreferenceForm.formState.errors.fuelPreferenceMode.message}
                              </FormMessage>
                            ) : null}
                          </FormItem>

                          <DialogFooter>
                            <Button type="submit" disabled={!canEditFuelPreference}>
                              {updateFuelPreferenceMutation.isPending
                                ? 'Сохраняем...'
                                : 'Сохранить'}
                            </Button>
                          </DialogFooter>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
              <div>
                <span className="text-slate-500">Предпочтение</span>
                <p className="font-medium text-slate-950">
                  {fuelPreferenceLabels[activeReservation.fuel_preference_mode] ??
                    fuelPreferenceLabels.EXACT}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Литры</span>
                <p className="font-medium text-slate-950">
                  {activeReservation.requested_liters}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Позиция в очереди топлива</span>
                <p className="font-medium text-slate-950">{fuelQueuePositionLabel}</p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-950">Дневное распределение</p>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-slate-500">АЗС</span>
                  <p className="flex items-center gap-1.5 font-medium text-slate-950">
                    <MapPin className="size-4 text-slate-500" aria-hidden="true" />
                    {stationLabel}
                  </p>
                  {stationAddress ? (
                    <p className="mt-1 text-xs text-slate-500">{stationAddress}</p>
                  ) : null}
                </div>
                {matchedFuelLabel ? (
                  <div>
                    <span className="text-slate-500">Доступная марка</span>
                    <p className="font-medium text-slate-950">{matchedFuelLabel}</p>
                  </div>
                ) : null}
                <div>
                  <span className="text-slate-500">Статус дневного лимита</span>
                  <div className="mt-1">
                    <Badge variant="outline" className={`rounded-md ${limitStatusView.className}`}>
                      {hasDailyDistribution ? limitStatusView.label : 'Ожидает распределения'}
                    </Badge>
                  </div>
                </div>
                {estimatedArrivalTime ? (
                  <div>
                    <span className="text-slate-500">Примерное прибытие</span>
                    <p className="flex items-center gap-1.5 font-medium text-slate-950">
                      <Clock className="size-4 text-slate-500" aria-hidden="true" />
                      {estimatedArrivalTime}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            {isFuelPreferenceUpdateLocked ? (
              <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>Сейчас идет заправка</AlertTitle>
                <AlertDescription>
                  Марку топлива и предпочтение можно изменить после завершения текущей заправки.
                </AlertDescription>
              </Alert>
            ) : null}

            <Alert>
              <AlertTitle>Можно поставить в очередь только один автомобиль</AlertTitle>
              <AlertDescription>
                Сейчас в очереди стоит {activeReservation.normalized_plate_number}. Новая запись
                будет доступна после заправки или отмены текущей записи.
              </AlertDescription>
            </Alert>

            {updateFuelPreferenceMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Марка топлива не сохранена</AlertTitle>
                <AlertDescription>
                  {getConsumerCabinetErrorMessage(
                    updateFuelPreferenceMutation.error,
                    'Не удалось сохранить марку топлива.',
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            {canCancelReservation ? (
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full gap-2"
                disabled={cancelReservationMutation.isPending}
                onClick={() =>
                  cancelReservationMutation.mutate({
                    reservationId: activeReservation.id,
                    clientMutationId: crypto.randomUUID(),
                  })
                }
              >
                <XCircle className="size-4" aria-hidden="true" />
                {cancelReservationMutation.isPending ? 'Отменяем...' : 'Отменить запись'}
              </Button>
            ) : (
              <Alert>
                <AlertTitle>Самостоятельная отмена недоступна</AlertTitle>
                <AlertDescription>
                  Запись уже взята в работу. Для изменений обратитесь к сотруднику.
                </AlertDescription>
              </Alert>
            )}

            {cancelReservationMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Запись не отменена</AlertTitle>
                <AlertDescription>
                  {getConsumerCabinetErrorMessage(
                    cancelReservationMutation.error,
                    'Не удалось отменить запись.',
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {todayFuelingStatus ? (
        <Card className="rounded-lg border-emerald-200 bg-emerald-50 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-950">
              <Ticket className="size-5 text-emerald-700" aria-hidden="true" />
              Сегодня заправлено
            </CardTitle>
            <CardDescription className="text-emerald-800">
              {todayFuelingStatus.ticket_number
                ? `Запись №${todayFuelingStatus.ticket_number}`
                : 'Заправка за сегодня'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <span className="text-emerald-700">Госномер</span>
              <p className="font-medium text-emerald-950">
                {todayFuelingStatus.normalized_plate_number}
              </p>
            </div>
            <div>
              <span className="text-emerald-700">АЗС</span>
              <p className="flex items-center gap-1.5 font-medium text-emerald-950">
                <MapPin className="size-4 text-emerald-700" aria-hidden="true" />
                {todayFuelingStatus.station_name ?? 'АЗС не указана'}
              </p>
              {todayFuelingStatus.station_address ? (
                <p className="mt-1 text-xs text-emerald-700">
                  {todayFuelingStatus.station_address}
                </p>
              ) : null}
            </div>
            <div>
              <span className="text-emerald-700">Топливо</span>
              <p className="font-medium text-emerald-950">
                {fuelTypeLabels[todayFuelingStatus.fuel_type] ?? todayFuelingStatus.fuel_type}
              </p>
            </div>
            <div>
              <span className="text-emerald-700">Литры</span>
              <p className="font-medium text-emerald-950">{todayFuelingStatus.liters}</p>
            </div>
            <div>
              <span className="text-emerald-700">Время</span>
              <p className="flex items-center gap-1.5 font-medium text-emerald-950">
                <Clock className="size-4 text-emerald-700" aria-hidden="true" />
                {formatDateTime(todayFuelingStatus.fueled_at)}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Car className="size-5 text-slate-500" aria-hidden="true" />
            Автомобили
          </CardTitle>
          <CardDescription>В записи можно выбрать только один из этих госномеров.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {vehicles.length === 0 ? (
            <p className="text-sm text-slate-500">
              Добавьте автомобиль, чтобы встать в очередь.
            </p>
          ) : (
            vehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <span className="font-medium text-slate-950">
                  {vehicle.normalized_plate_number}
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="rounded-md bg-white">
                    Действует
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-slate-500 hover:text-red-700"
                    disabled={unlinkVehicleMutation.isPending}
                    onClick={() => {
                      unlinkVehicleMutation.reset()
                      setSelectedUnlinkVehicle(vehicle)
                    }}
                    title="Отвязать номер"
                    aria-label={`Отвязать номер ${vehicle.normalized_plate_number}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selectedUnlinkVehicle)}
        onOpenChange={(open) => {
          if (!open) {
            unlinkVehicleMutation.reset()
            setSelectedUnlinkVehicle(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отвязать номер?</DialogTitle>
            <DialogDescription>
              {selectedUnlinkVehicle
                ? `Номер ${selectedUnlinkVehicle.normalized_plate_number} исчезнет из личного кабинета. Его нельзя отвязать, пока автомобиль стоит в активной очереди.`
                : 'Номер исчезнет из личного кабинета.'}
            </DialogDescription>
          </DialogHeader>

          {unlinkVehicleMutation.error ? (
            <Alert variant="destructive">
              <AlertTitle>Номер не отвязан</AlertTitle>
              <AlertDescription>{unlinkVehicleMutation.error.message}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={unlinkVehicleMutation.isPending}>
                Отмена
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={!selectedUnlinkVehicle || unlinkVehicleMutation.isPending}
              onClick={handleUnlinkVehicle}
            >
              {unlinkVehicleMutation.isPending ? 'Отвязываем...' : 'Отвязать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canAddVehicle ? (
        <AddConsumerVehicleForm disabled={vehiclesQuery.isLoading} />
      ) : (
        <Alert>
          <AlertTitle>Лимит автомобилей достигнут</AlertTitle>
          <AlertDescription>У одного жителя может быть не более 3 автомобилей.</AlertDescription>
        </Alert>
      )}

      {canCreateReservation ? (
        <CreateConsumerReservationForm vehicles={vehicles} />
      ) : !activeReservation && vehicles.length === 0 ? null : null}
    </div>
  )
}
