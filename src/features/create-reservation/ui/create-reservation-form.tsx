import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarPlus, Ticket } from 'lucide-react'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { PlateNumberInput } from '@/entities/vehicle'
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
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { PhoneNumberInput } from '@/shared/ui/phone-number-input'
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

export function CreateReservationForm() {
  const createReservationMutation = useCreateReservation()
  const form = useForm<CreateReservationFormInput, unknown, CreateReservationFormValues>({
    resolver: zodResolver(createReservationSchema),
    mode: 'onBlur',
    defaultValues: createReservationFormDefaultValues,
  })
  const watchedFuelType = form.watch('fuelType')
  const isGasolineSelected = isGasolineFuelType(watchedFuelType)

  useEffect(() => {
    if (!isGasolineFuelType(watchedFuelType)) {
      form.setValue('fuelPreferenceMode', 'EXACT', { shouldValidate: true })
    }
  }, [form, watchedFuelType])

  async function handleSubmit(values: CreateReservationFormValues) {
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
    } catch {
      // Mutation state renders the error alert below.
    }
  }


  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarPlus className="size-5 text-slate-500" aria-hidden="true" />
          Постановка в городскую очередь
        </CardTitle>
        <CardDescription>Постоянный номер выдаст сервер; дата, АЗС и время назначаются по лимитам.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
            <FormItem>
              <FormLabel htmlFor="plateNumber">Госномер</FormLabel>
              <div>
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
              </div>
              {form.formState.errors.plateNumber ? (
                <FormMessage>{form.formState.errors.plateNumber.message}</FormMessage>
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
              disabled={createReservationMutation.isPending}
            >
              <Ticket className="size-4" aria-hidden="true" />
              {createReservationMutation.isPending ? 'Добавляем...' : 'Добавить в очередь'}
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
                  {createReservationMutation.data.permanent_number
                    ? `Постоянный номер №${createReservationMutation.data.permanent_number}, `
                    : 'Ожидает подтверждения сервера, '}
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
