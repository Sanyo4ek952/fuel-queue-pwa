import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarPlus, Search, Ticket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'

import {
  type CreateReservationFormInput,
  type CreateReservationFormValues,
  createReservationSchema,
  useCreateReservation,
} from '@/features/create-reservation'
import {
  buildVehicleFuelingHistoryViewResult,
  useCheckVehicleAccess,
  useVehicleFuelingHistory,
  VehicleAccessResultView,
  VehicleFuelingHistoryPanel,
} from '@/features/check-vehicle'
import { StationSelect, useSelectedStation } from '@/features/select-station'
import { FUEL_TYPES, type FuelType } from '@/shared/constants'
import { getTomorrowDateInputValue } from '@/shared/lib/date'
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
    defaultValues: {
      targetDate: getTomorrowDateInputValue(),
      plateNumber: '',
      driverFullName: '',
      driverPhone: '',
      fuelType: 'AI_95',
      requestedLiters: 40,
      comment: '',
    },
  })
  const watchedPlateNumber = form.watch('plateNumber')
  const watchedTargetDate = form.watch('targetDate')

  useEffect(() => {
    resetCheckVehicleAccess()
    setHistoryPlateNumber('')
  }, [watchedPlateNumber, watchedTargetDate, selectedStationId, resetCheckVehicleAccess])

  async function handleSubmit(values: CreateReservationFormValues) {
    if (!selectedStationId) {
      return
    }

    await createReservationMutation.mutateAsync({
      targetDate: values.targetDate,
      stationId: selectedStationId,
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
    const canCheck = await form.trigger(['targetDate', 'plateNumber'])

    if (!selectedStationId || !canCheck) {
      return
    }

    const values = form.getValues()
    setHistoryPlateNumber(values.plateNumber)

    await checkVehicleAccessMutation.mutateAsync({
      plateNumber: values.plateNumber,
      stationId: selectedStationId,
      checkDate: values.targetDate,
    })
  }

  const isSubmitDisabled = !selectedStationId || createReservationMutation.isPending
  const isCheckDisabled =
    !selectedStationId ||
    !watchedPlateNumber.trim() ||
    !watchedTargetDate ||
    checkVehicleAccessMutation.isPending
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
        <CardDescription>Дата по умолчанию открывается на завтра.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
            <StationSelect />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="targetDate">Дата</FormLabel>
                <Input id="targetDate" type="date" {...form.register('targetDate')} />
                {form.formState.errors.targetDate ? (
                  <FormMessage>{form.formState.errors.targetDate.message}</FormMessage>
                ) : null}
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="plateNumber">Госномер</FormLabel>
                <div className="flex gap-2">
                  <Input
                    id="plateNumber"
                    autoComplete="off"
                    inputMode="text"
                    placeholder="А123ВС"
                    className="uppercase"
                    {...form.register('plateNumber')}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 gap-2"
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
            </div>

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
                    form.setValue('fuelType', value as FuelType, { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="fuelType" className="h-10 w-full bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    {FUEL_TYPES.map((fuelType) => (
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

            {!selectedStationId ? (
              <p className="text-sm text-slate-500">Выберите АЗС перед созданием записи.</p>
            ) : null}

            <Button type="submit" className="h-11 w-full gap-2" disabled={isSubmitDisabled}>
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
