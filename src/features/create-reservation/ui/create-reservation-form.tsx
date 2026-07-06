import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarPlus, Search, Ticket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { PlateNumberInput } from '@/entities/vehicle'
import {
  buildVehicleFuelingHistoryViewResult,
  useCheckVehicleAccess,
  useVehicleFuelingHistory,
  VehicleAccessResultView,
  VehicleFuelingHistoryPanel,
} from '@/features/check-vehicle'
import {
  type CreateReservationFormInput,
  type CreateReservationFormValues,
  createReservationSchema,
  useCreateReservation,
} from '@/features/create-reservation'
import { StationSelect, useSelectedStation } from '@/features/select-station'
import { QUEUE_FUEL_TYPES, type FuelType, type QueueFuelType } from '@/shared/constants'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
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

const fuelTypeLabels: Record<FuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
  OTHER: 'Другое',
}

export function CreateReservationForm() {
  const selectedStationId = useSelectedStation((state) => state.selectedStationId)
  const createReservationMutation = useCreateReservation()
  const checkVehicleAccessMutation = useCheckVehicleAccess()
  const resetCheckVehicleAccess = checkVehicleAccessMutation.reset
  const [historyPlateNumber, setHistoryPlateNumber] = useState('')
  const vehicleFuelingHistoryQuery = useVehicleFuelingHistory({
    plateNumber: historyPlateNumber,
    enabled: Boolean(historyPlateNumber),
  })
  const form = useForm<CreateReservationFormInput, unknown, CreateReservationFormValues>({
    resolver: zodResolver(createReservationSchema),
    mode: 'onBlur',
    defaultValues: {
      plateNumber: '',
      driverFullName: '',
      driverPhone: '',
      fuelType: 'AI_95',
      requestedLiters: 40,
      comment: '',
    },
  })
  const watchedPlateNumber = form.watch('plateNumber')

  useEffect(() => {
    resetCheckVehicleAccess()
    setHistoryPlateNumber('')
  }, [watchedPlateNumber, selectedStationId, resetCheckVehicleAccess])

  async function handleSubmit(values: CreateReservationFormValues) {
    await createReservationMutation.mutateAsync({
      plateNumber: values.plateNumber,
      driverFullName: values.driverFullName,
      driverPhone: values.driverPhone,
      fuelType: values.fuelType,
      requestedLiters: values.requestedLiters,
      comment: values.comment,
      clientMutationId: crypto.randomUUID(),
    })
  }

  async function handleCheckVehicle() {
    const canCheck = await form.trigger('plateNumber')

    if (!selectedStationId || !canCheck) {
      return
    }

    const normalizedPlateNumber = normalizePlateNumber(form.getValues('plateNumber'))
    setHistoryPlateNumber(normalizedPlateNumber)

    await checkVehicleAccessMutation.mutateAsync({
      plateNumber: normalizedPlateNumber,
      stationId: selectedStationId,
      checkDate: getTodayDateInputValue(),
    })
  }

  const isCheckDisabled =
    !selectedStationId || !watchedPlateNumber.trim() || checkVehicleAccessMutation.isPending
  const accessResult = checkVehicleAccessMutation.data
  const fuelingHistoryViewResult = buildVehicleFuelingHistoryViewResult(
    vehicleFuelingHistoryQuery.data,
  )

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
            <StationSelect />

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
              {!selectedStationId ? (
                <p className="text-sm text-slate-500">
                  Выберите АЗС только для проверки допуска. Запись останется в общей очереди.
                </p>
              ) : null}
            </FormItem>

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
                <Input
                  id="driverPhone"
                  autoComplete="tel"
                  inputMode="tel"
                  {...form.register('driverPhone')}
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
              disabled={createReservationMutation.isPending}
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
                  Очередь №{createReservationMutation.data.queue_number},{' '}
                  {createReservationMutation.data.normalized_plate_number},{' '}
                  {createReservationMutation.data.requested_liters} л.
                </AlertDescription>
              </Alert>
            ) : null}

            {accessResult ? <VehicleAccessResultView result={accessResult} /> : null}

            {historyPlateNumber ? (
              <VehicleFuelingHistoryPanel
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
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
