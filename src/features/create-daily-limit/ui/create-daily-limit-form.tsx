import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarDays, Save } from 'lucide-react'
import { useForm } from 'react-hook-form'

import {
  type CreateDailyLimitFormInput,
  type CreateDailyLimitFormValues,
  createDailyLimitSchema,
  useCreateDailyLimit,
} from '@/features/create-daily-limit'
import { StationSelect, useSelectedStation } from '@/features/select-station'
import { FUEL_TYPES, type FuelType } from '@/shared/constants'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

const fuelTypeLabels: Record<FuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
  OTHER: 'Другое',
}

const defaultFuelTypeLimits = FUEL_TYPES.map((fuelType) => ({
  fuelType,
  vehicleLimit: 0,
  litersLimit: null,
}))

export function CreateDailyLimitForm() {
  const selectedStationId = useSelectedStation((state) => state.selectedStationId)
  const createDailyLimitMutation = useCreateDailyLimit()
  const form = useForm<CreateDailyLimitFormInput, unknown, CreateDailyLimitFormValues>({
    resolver: zodResolver(createDailyLimitSchema),
    defaultValues: {
      targetDate: getTodayDateInputValue(),
      totalVehicleLimit: 100,
      maxLitersPerVehicle: 50,
      fuelTypeLimits: defaultFuelTypeLimits,
    },
  })

  async function handleSubmit(values: CreateDailyLimitFormValues) {
    if (!selectedStationId) {
      return
    }

    await createDailyLimitMutation.mutateAsync({
      targetDate: values.targetDate,
      stationId: selectedStationId,
      totalVehicleLimit: values.totalVehicleLimit,
      maxLitersPerVehicle: values.maxLitersPerVehicle,
      fuelTypeLimits: values.fuelTypeLimits,
      clientMutationId: crypto.randomUUID(),
    })
  }

  const isSubmitDisabled = !selectedStationId || createDailyLimitMutation.isPending
  const fuelTypeLimitsError = form.formState.errors.fuelTypeLimits?.message

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="size-5 text-slate-500" aria-hidden="true" />
          Лимит на дату
        </CardTitle>
        <CardDescription>Задайте общий лимит и распределение по видам топлива.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
            <StationSelect />

            <div className="grid gap-4 sm:grid-cols-3">
              <FormItem>
                <FormLabel htmlFor="targetDate">Дата</FormLabel>
                <Input id="targetDate" type="date" {...form.register('targetDate')} />
                {form.formState.errors.targetDate ? (
                  <FormMessage>{form.formState.errors.targetDate.message}</FormMessage>
                ) : null}
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="totalVehicleLimit">Машин всего</FormLabel>
                <Input
                  id="totalVehicleLimit"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  {...form.register('totalVehicleLimit')}
                />
                {form.formState.errors.totalVehicleLimit ? (
                  <FormMessage>{form.formState.errors.totalVehicleLimit.message}</FormMessage>
                ) : null}
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="maxLitersPerVehicle">Литров на авто</FormLabel>
                <Input
                  id="maxLitersPerVehicle"
                  type="number"
                  min={1}
                  step="0.01"
                  inputMode="decimal"
                  {...form.register('maxLitersPerVehicle')}
                />
                {form.formState.errors.maxLitersPerVehicle ? (
                  <FormMessage>{form.formState.errors.maxLitersPerVehicle.message}</FormMessage>
                ) : null}
              </FormItem>
            </div>

            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-medium text-slate-800">Лимиты по топливу</h2>
                <p className="text-sm text-slate-500">
                  Нулевой лимит означает, что запись на этот вид топлива будет недоступна.
                </p>
              </div>
              <div className="grid gap-3">
                {FUEL_TYPES.map((fuelType, index) => (
                  <div
                    key={fuelType}
                    className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_120px_140px]"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">{fuelTypeLabels[fuelType]}</p>
                      <input
                        type="hidden"
                        value={fuelType}
                        {...form.register(`fuelTypeLimits.${index}.fuelType`)}
                      />
                    </div>
                    <FormItem>
                      <FormLabel htmlFor={`fuelTypeVehicleLimit-${fuelType}`}>Машин</FormLabel>
                      <Input
                        id={`fuelTypeVehicleLimit-${fuelType}`}
                        type="number"
                        min={0}
                        inputMode="numeric"
                        {...form.register(`fuelTypeLimits.${index}.vehicleLimit`)}
                      />
                      {form.formState.errors.fuelTypeLimits?.[index]?.vehicleLimit ? (
                        <FormMessage>
                          {form.formState.errors.fuelTypeLimits[index]?.vehicleLimit?.message}
                        </FormMessage>
                      ) : null}
                    </FormItem>
                    <FormItem>
                      <FormLabel htmlFor={`fuelTypeLitersLimit-${fuelType}`}>Литров</FormLabel>
                      <Input
                        id={`fuelTypeLitersLimit-${fuelType}`}
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        placeholder="Без лимита"
                        {...form.register(`fuelTypeLimits.${index}.litersLimit`)}
                      />
                      {form.formState.errors.fuelTypeLimits?.[index]?.litersLimit ? (
                        <FormMessage>
                          {form.formState.errors.fuelTypeLimits[index]?.litersLimit?.message}
                        </FormMessage>
                      ) : null}
                    </FormItem>
                  </div>
                ))}
              </div>
              {fuelTypeLimitsError ? <FormMessage>{fuelTypeLimitsError}</FormMessage> : null}
            </div>

            {!selectedStationId ? (
              <p className="text-sm text-slate-500">Выберите АЗС перед созданием лимита.</p>
            ) : null}

            <Button type="submit" className="h-11 w-full gap-2" disabled={isSubmitDisabled}>
              <Save className="size-4" aria-hidden="true" />
              {createDailyLimitMutation.isPending ? 'Сохраняем...' : 'Сохранить лимит'}
            </Button>

            {createDailyLimitMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Лимит не сохранён</AlertTitle>
                <AlertDescription>{createDailyLimitMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}

            {createDailyLimitMutation.data ? (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                <AlertTitle>Лимит сохранён</AlertTitle>
                <AlertDescription>
                  Дата {createDailyLimitMutation.data.date}, общий лимит{' '}
                  {createDailyLimitMutation.data.total_vehicle_limit} машин.
                </AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
