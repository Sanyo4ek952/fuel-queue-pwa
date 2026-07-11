import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarPlus, Ticket } from 'lucide-react'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { useCurrentProfile } from '@/entities/profile'
import {
  createConsumerReservationSchema,
  type CreateConsumerReservationFormInput,
  type CreateConsumerReservationFormValues,
  useCreateConsumerReservation,
} from '@/features/create-consumer-reservation'
import { useResidentFuelNorm } from '@/features/manage-resident-fuel-norm'
import type { ConsumerVehicle } from '@/shared/api/rpc'
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
  ANY_GASOLINE: 'Подойдет АИ-92/95/100',
}

type CreateConsumerReservationFormProps = {
  vehicles: ConsumerVehicle[]
  disabled?: boolean
}

function getProfileFullName(profile: ReturnType<typeof useCurrentProfile>['data']) {
  return profile?.full_name ?? ''
}

export function CreateConsumerReservationForm({
  vehicles,
  disabled,
}: CreateConsumerReservationFormProps) {
  const currentProfileQuery = useCurrentProfile()
  const createReservationMutation = useCreateConsumerReservation()
  const residentFuelNormQuery = useResidentFuelNorm()
  const form = useForm<
    CreateConsumerReservationFormInput,
    unknown,
    CreateConsumerReservationFormValues
  >({
    resolver: zodResolver(createConsumerReservationSchema),
    mode: 'onBlur',
    defaultValues: {
      vehicleId: vehicles[0]?.id ?? '',
      driverFullName: getProfileFullName(currentProfileQuery.data),
      driverPhone: '',
      fuelType: 'AI_95',
      fuelPreferenceMode: 'EXACT',
      comment: '',
    },
  })
  const watchedFuelType = form.watch('fuelType')
  const isGasolineSelected = isGasolineFuelType(watchedFuelType)

  useEffect(() => {
    if (!form.getValues('vehicleId') && vehicles[0]?.id) {
      form.setValue('vehicleId', vehicles[0].id, { shouldValidate: true })
    }
  }, [form, vehicles])

  useEffect(() => {
    if (!form.getValues('driverFullName') && currentProfileQuery.data?.full_name) {
      form.setValue('driverFullName', currentProfileQuery.data.full_name, {
        shouldValidate: true,
      })
    }
  }, [currentProfileQuery.data?.full_name, form])

  useEffect(() => {
    if (!isGasolineFuelType(watchedFuelType)) {
      form.setValue('fuelPreferenceMode', 'EXACT', { shouldValidate: true })
    }
  }, [form, watchedFuelType])

  async function handleSubmit(values: CreateConsumerReservationFormValues) {
    await createReservationMutation.mutateAsync({
      vehicleId: values.vehicleId,
      driverFullName: values.driverFullName,
      driverPhone: values.driverPhone,
      fuelType: values.fuelType,
      fuelPreferenceMode: values.fuelPreferenceMode,
      comment: values.comment,
      clientMutationId: crypto.randomUUID(),
    })
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarPlus className="size-5 text-slate-500" aria-hidden="true" />
          Встать в очередь
        </CardTitle>
        <CardDescription>
          Запись создается в общей очереди по выбранному автомобилю.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
            <FormItem>
              <FormLabel htmlFor="consumerVehicleId">Автомобиль</FormLabel>
              <Select
                value={form.watch('vehicleId')}
                onValueChange={(value) =>
                  form.setValue('vehicleId', value, { shouldValidate: true })
                }
                disabled={disabled || createReservationMutation.isPending}
              >
                <SelectTrigger id="consumerVehicleId" className="h-10 w-full bg-white">
                  <SelectValue placeholder="Выберите автомобиль" />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {vehicles.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.normalized_plate_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.vehicleId ? (
                <FormMessage>{form.formState.errors.vehicleId.message}</FormMessage>
              ) : null}
            </FormItem>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="consumerDriverFullName">Водитель</FormLabel>
                <Input
                  id="consumerDriverFullName"
                  autoComplete="name"
                  {...form.register('driverFullName')}
                />
                {form.formState.errors.driverFullName ? (
                  <FormMessage>{form.formState.errors.driverFullName.message}</FormMessage>
                ) : null}
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="consumerDriverPhone">Телефон</FormLabel>
                <Controller
                  control={form.control}
                  name="driverPhone"
                  render={({ field }) => (
                    <PhoneNumberInput
                      id="consumerDriverPhone"
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
                <FormLabel htmlFor="consumerFuelType">Топливо</FormLabel>
                <Select
                  value={form.watch('fuelType')}
                  onValueChange={(value) =>
                    form.setValue('fuelType', value as QueueFuelType, { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="consumerFuelType" className="h-10 w-full bg-white">
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
                  <FormLabel htmlFor="consumerFuelPreferenceMode">Предпочтение</FormLabel>
                  <Select
                    value={form.watch('fuelPreferenceMode')}
                    onValueChange={(value) =>
                      form.setValue('fuelPreferenceMode', value as FuelPreferenceMode, {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger
                      id="consumerFuelPreferenceMode"
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
                  {form.formState.errors.fuelPreferenceMode ? (
                    <FormMessage>{form.formState.errors.fuelPreferenceMode.message}</FormMessage>
                  ) : null}
                </FormItem>
              ) : null}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Норма литров</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">
                {residentFuelNormQuery.data?.liters ?? 20} л
              </p>
            </div>

            <FormItem>
              <FormLabel htmlFor="consumerComment">Комментарий</FormLabel>
              <Input id="consumerComment" {...form.register('comment')} />
              {form.formState.errors.comment ? (
                <FormMessage>{form.formState.errors.comment.message}</FormMessage>
              ) : null}
            </FormItem>

            <Button
              type="submit"
              className="h-11 w-full gap-2"
              disabled={disabled || createReservationMutation.isPending || vehicles.length === 0}
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
                  Запись создана в общей очереди. Ваш постоянный номер №
                  {createReservationMutation.data.permanent_number}.{' '}
                  {createReservationMutation.data.normalized_plate_number},{' '}
                  {createReservationMutation.data.requested_liters} л.
                  <br />
                  {createReservationMutation.data.station_name
                    ? `АЗС: ${createReservationMutation.data.station_name}.`
                    : 'АЗС будет назначена дневным распределением.'}
                </AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
