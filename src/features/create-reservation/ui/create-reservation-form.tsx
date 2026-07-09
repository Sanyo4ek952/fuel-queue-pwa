import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarPlus, Search, Ticket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { useCurrentProfile } from '@/entities/profile'
import { PlateNumberInput } from '@/entities/vehicle'
import {
  type VehicleAccessResult,
  useCheckVehicleAccess,
  useVehicleFuelingHistoryPreview,
  VehicleAccessResultView,
  VehicleFuelingHistoryAccordion,
} from '@/features/check-vehicle'
import {
  type CreateReservationFormInput,
  type CreateReservationFormValues,
  createReservationSchema,
  useCreateReservation,
} from '@/features/create-reservation'
import {
  QUEUE_FUEL_TYPES,
  isGasolineFuelType,
  type FuelPreferenceMode,
  type FuelType,
  type QueueFuelType,
} from '@/shared/constants'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
import { useProfileStationSelection } from '@/shared/lib/station-selection'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { PhoneNumberInput } from '@/shared/ui/phone-number-input'
import { StationSelectField } from '@/shared/ui/station-select-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { ROUTES } from '@/shared/config/routes'

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

const createReservationFormDefaultValues = {
  plateNumber: '',
  driverFullName: '',
  driverPhone: '',
  fuelType: 'AI_95',
  fuelPreferenceMode: 'EXACT',
  requestedLiters: 20,
  comment: '',
} satisfies CreateReservationFormInput

const HISTORY_ACCORDION_VALUE = 'fueling-history'
const reservationCheckReasonLabelOverrides = {
  ACTIVE_RESERVATION: 'Автомобиль уже есть в очереди. Повторная запись запрещена.',
  NO_ACTIVE_RESERVATION: 'Автомобиля нет в очереди. Можно создать запись.',
} as const
const reservationCheckBlockedReasonOverrides = {
  ACTIVE_RESERVATION: 'Автомобиль уже есть в очереди. Повторная запись запрещена.',
} as const

function canCreateReservationAfterCheck(
  result: VehicleAccessResult | undefined,
  normalizedPlateNumber: string,
) {
  if (!result || !normalizedPlateNumber || result.normalized_plate_number !== normalizedPlateNumber) {
    return false
  }

  if (result.reason === 'ACTIVE_RESERVATION' || result.offline_decision === 'BLOCKED') {
    return false
  }

  if (result.status === 'BLOCKED' && result.reason !== 'NO_ACTIVE_RESERVATION') {
    return false
  }

  return (
    result.status === 'ALLOWED' ||
    result.reason === 'NO_ACTIVE_RESERVATION' ||
    result.offline_decision === 'ALLOWED'
  )
}

export function CreateReservationForm() {
  const currentProfileQuery = useCurrentProfile()
  const stations = currentProfileQuery.data?.stations ?? []
  const [selectedStationId, setSelectedStationId] = useProfileStationSelection(stations)
  const createReservationMutation = useCreateReservation()
  const checkVehicleAccessMutation = useCheckVehicleAccess()
  const resetCheckVehicleAccess = checkVehicleAccessMutation.reset
  const [historyPlateNumber, setHistoryPlateNumber] = useState('')
  const [historyAccordionValue, setHistoryAccordionValue] = useState('')
  const isHistoryOpen = historyAccordionValue === HISTORY_ACCORDION_VALUE
  const vehicleFuelingHistoryQuery = useVehicleFuelingHistoryPreview({
    plateNumber: historyPlateNumber,
    enabled: Boolean(historyPlateNumber) && isHistoryOpen,
  })
  const form = useForm<CreateReservationFormInput, unknown, CreateReservationFormValues>({
    resolver: zodResolver(createReservationSchema),
    mode: 'onBlur',
    defaultValues: createReservationFormDefaultValues,
  })
  const watchedPlateNumber = form.watch('plateNumber')
  const watchedFuelType = form.watch('fuelType')
  const normalizedWatchedPlateNumber = normalizePlateNumber(watchedPlateNumber)
  const isGasolineSelected = isGasolineFuelType(watchedFuelType)

  useEffect(() => {
    resetCheckVehicleAccess()
    setHistoryPlateNumber('')
    setHistoryAccordionValue('')
  }, [watchedPlateNumber, selectedStationId, resetCheckVehicleAccess])

  useEffect(() => {
    if (!isGasolineFuelType(watchedFuelType)) {
      form.setValue('fuelPreferenceMode', 'EXACT', { shouldValidate: true })
    }
  }, [form, watchedFuelType])

  async function handleSubmit(values: CreateReservationFormValues) {
    if (!canCreateReservationAfterCheck(accessResult, values.plateNumber)) {
      form.setError('plateNumber', {
        message:
          accessResult?.reason === 'ACTIVE_RESERVATION'
            ? reservationCheckReasonLabelOverrides.ACTIVE_RESERVATION
            : 'Перед записью нужно проверить номер и получить разрешение.',
      })
      return
    }

    try {
      await createReservationMutation.mutateAsync({
        plateNumber: values.plateNumber,
        driverFullName: values.driverFullName,
        driverPhone: values.driverPhone,
        fuelType: values.fuelType,
        fuelPreferenceMode: values.fuelPreferenceMode,
        requestedLiters: values.requestedLiters,
        comment: values.comment,
        clientMutationId: crypto.randomUUID(),
      })
      form.reset(createReservationFormDefaultValues)
      resetCheckVehicleAccess()
      setHistoryPlateNumber('')
      setHistoryAccordionValue('')
    } catch {
      // Mutation state renders the error alert below.
    }
  }

  async function handleCheckVehicle() {
    const canCheck = await form.trigger('plateNumber')

    if (!selectedStationId || !canCheck) {
      return
    }

    const normalizedPlateNumber = normalizePlateNumber(form.getValues('plateNumber'))
    setHistoryPlateNumber(normalizedPlateNumber)
    setHistoryAccordionValue('')

    await checkVehicleAccessMutation.mutateAsync({
      plateNumber: normalizedPlateNumber,
      stationId: selectedStationId,
      checkDate: getTodayDateInputValue(),
    })
  }

  const isCheckDisabled =
    !selectedStationId || !watchedPlateNumber.trim() || checkVehicleAccessMutation.isPending
  const accessResult = checkVehicleAccessMutation.data
  const canSubmitReservation = canCreateReservationAfterCheck(
    accessResult,
    normalizedWatchedPlateNumber,
  )
  const reservationAccessResult =
    accessResult?.reason === 'NO_ACTIVE_RESERVATION'
      ? ({ ...accessResult, status: 'ALLOWED' } as const)
      : accessResult
  const fuelingHistoryViewResult = vehicleFuelingHistoryQuery.data

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarPlus className="size-5 text-slate-500" aria-hidden="true" />
          Предварительная запись
        </CardTitle>
        <CardDescription>Добавление автомобиля в общую очередь.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
            <StationSelectField
              id="reservationCheckStationId"
              value={selectedStationId}
              stations={stations}
              onValueChange={setSelectedStationId}
              emptyMessage="АЗС не назначена. Проверка допуска недоступна."
            />
            <FormItem>
              <FormLabel htmlFor="plateNumber">Госномер</FormLabel>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Controller
                  control={form.control}
                  name="plateNumber"
                  render={({ field }) => (
                    <PlateNumberInput
                      id="plateNumber"
                      className="uppercase"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  )}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-2"
                  disabled={isCheckDisabled}
                  onClick={() => {
                    void handleCheckVehicle()
                  }}
                >
                  <Search className="size-4" aria-hidden="true" />
                  {checkVehicleAccessMutation.isPending ? 'Проверяем...' : 'Проверить'}
                </Button>
              </div>
              {form.formState.errors.plateNumber ? (
                <FormMessage>{form.formState.errors.plateNumber.message}</FormMessage>
              ) : null}
            </FormItem>

            {reservationAccessResult ? (
              <VehicleAccessResultView
                result={reservationAccessResult}
                blockedReasonOverrides={reservationCheckBlockedReasonOverrides}
                reasonLabelOverrides={reservationCheckReasonLabelOverrides}
              />
            ) : null}

            {historyPlateNumber ? (
              <VehicleFuelingHistoryAccordion
                plateNumber={historyPlateNumber}
                value={historyAccordionValue}
                onValueChange={(value) => setHistoryAccordionValue(value ?? '')}
                result={fuelingHistoryViewResult}
                isLoading={vehicleFuelingHistoryQuery.isLoading}
                isError={vehicleFuelingHistoryQuery.isError}
                fullHistoryTo={`${ROUTES.history}?plate=${encodeURIComponent(historyPlateNumber)}`}
              />
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="driverFullName">Водитель</FormLabel>
                <Input id="driverFullName" autoComplete="name" {...form.register('driverFullName')} />
                {form.formState.errors.driverFullName ? (
                  <FormMessage>{form.formState.errors.driverFullName.message}</FormMessage>
                ) : null}
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="driverPhone">Телефон</FormLabel>
                <Controller
                  control={form.control}
                  name="driverPhone"
                  render={({ field }) => (
                    <PhoneNumberInput
                      id="driverPhone"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  )}
                />
                {form.formState.errors.driverPhone ? (
                  <FormMessage>{form.formState.errors.driverPhone.message}</FormMessage>
                ) : null}
              </FormItem>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="fuelType">Топливо</FormLabel>
                <Select
                  value={form.watch('fuelType')}
                  onValueChange={(value) =>
                    form.setValue('fuelType', value as QueueFuelType, { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="fuelType" className="h-10 w-full bg-white">
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
                {form.formState.errors.fuelType ? (
                  <FormMessage>{form.formState.errors.fuelType.message}</FormMessage>
                ) : null}
              </FormItem>
              {isGasolineSelected ? (
                <FormItem>
                  <FormLabel htmlFor="fuelPreferenceMode">Предпочтение</FormLabel>
                  <Select
                    value={form.watch('fuelPreferenceMode')}
                    onValueChange={(value) =>
                      form.setValue('fuelPreferenceMode', value as FuelPreferenceMode, {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger id="fuelPreferenceMode" className="h-10 w-full bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      <SelectItem value="EXACT">{fuelPreferenceLabels.EXACT}</SelectItem>
                      <SelectItem value="ANY_GASOLINE">
                        {fuelPreferenceLabels.ANY_GASOLINE}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {form.formState.errors.fuelPreferenceMode ? (
                    <FormMessage>
                      {form.formState.errors.fuelPreferenceMode.message}
                    </FormMessage>
                  ) : null}
                </FormItem>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="requestedLiters">Литры</FormLabel>
                <Input
                  id="requestedLiters"
                  type="number"
                  min={1}
                  step="0.01"
                  inputMode="decimal"
                  {...form.register('requestedLiters')}
                />
                {form.formState.errors.requestedLiters ? (
                  <FormMessage>{form.formState.errors.requestedLiters.message}</FormMessage>
                ) : null}
              </FormItem>
            </div>

            <FormItem>
              <FormLabel htmlFor="comment">Комментарий</FormLabel>
              <Input id="comment" {...form.register('comment')} />
              {form.formState.errors.comment ? (
                <FormMessage>{form.formState.errors.comment.message}</FormMessage>
              ) : null}
            </FormItem>

            <Button
              type="submit"
              className="h-11 w-full gap-2"
              disabled={createReservationMutation.isPending || !canSubmitReservation}
            >
              <Ticket className="size-4" aria-hidden="true" />
              {createReservationMutation.isPending ? 'Записываем...' : 'Создать запись'}
            </Button>

            {createReservationMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Запись не создана</AlertTitle>
                <AlertDescription>{createReservationMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}

            {createReservationMutation.data ? (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                <AlertTitle>Запись создана</AlertTitle>
                <AlertDescription>
                  {'Номер записи №'}
                  {createReservationMutation.data.ticket_number ??
                    createReservationMutation.data.queue_number},{' '}
                  {createReservationMutation.data.normalized_plate_number},{' '}
                  {createReservationMutation.data.requested_liters} л,{' '}
                  {fuelPreferenceLabels[createReservationMutation.data.fuel_preference_mode]}.
                </AlertDescription>
              </Alert>
            ) : null}

          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
