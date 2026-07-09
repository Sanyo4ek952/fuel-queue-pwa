import { zodResolver } from '@hookform/resolvers/zod'
import { Clock3, Save } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import {
  fuelingScheduleFormSchema,
  type FuelingScheduleFormInput,
  type FuelingScheduleFormValues,
} from '../model/schema'
import { useDailyFuelingSchedule, useSetDailyFuelingSchedule } from '../model/use-fueling-schedule'
import type { FuelQueueCategory } from '@/shared/constants'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

type FuelingScheduleSettingsCardProps = {
  canEdit: boolean
}

const fuelCategoryLabels: Record<FuelQueueCategory, string> = {
  GASOLINE: 'Бензин',
  DIESEL: 'Дизель',
  GAS: 'Газ',
}

const fuelCategories: FuelQueueCategory[] = ['GASOLINE', 'DIESEL', 'GAS']

function buildDefaultSchedules() {
  return fuelCategories.map((fuelCategory) => ({
    fuelCategory,
    startTime: '13:00',
    intervalMinutes: 5,
    vehiclesPerInterval: 5,
  }))
}

export function FuelingScheduleSettingsCard({ canEdit }: FuelingScheduleSettingsCardProps) {
  const form = useForm<FuelingScheduleFormInput, unknown, FuelingScheduleFormValues>({
    resolver: zodResolver(fuelingScheduleFormSchema),
    defaultValues: {
      targetDate: getTodayDateInputValue(),
      schedules: buildDefaultSchedules(),
    },
  })
  const targetDate = form.watch('targetDate')
  const scheduleQuery = useDailyFuelingSchedule(targetDate)
  const setScheduleMutation = useSetDailyFuelingSchedule()

  useEffect(() => {
    if (!scheduleQuery.data) {
      return
    }

    const rowsByCategory = new Map(scheduleQuery.data.map((row) => [row.fuel_category, row]))

    form.reset({
      targetDate,
      schedules: fuelCategories.map((fuelCategory) => {
        const row = rowsByCategory.get(fuelCategory)

        return {
          fuelCategory,
          startTime: row?.start_time ?? '13:00',
          intervalMinutes: row?.interval_minutes ?? 5,
          vehiclesPerInterval: row?.vehicles_per_interval ?? 5,
        }
      }),
    })
  }, [form, scheduleQuery.data, targetDate])

  async function handleSubmit(values: FuelingScheduleFormValues) {
    await setScheduleMutation.mutateAsync({
      targetDate: values.targetDate,
      schedules: values.schedules,
      clientMutationId: crypto.randomUUID(),
    })
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock3 className="size-5 text-slate-500" aria-hidden="true" />
          Расписание розлива
        </CardTitle>
        <CardDescription>
          Время прибытия автомобилей рассчитывается по позиции внутри категории топлива.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {scheduleQuery.isLoading ? (
          <p className="text-sm text-slate-500">Загружаем расписание...</p>
        ) : null}

        {scheduleQuery.error ? (
          <Alert variant="destructive">
            <AlertTitle>Расписание не загружено</AlertTitle>
            <AlertDescription>{scheduleQuery.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {!canEdit && !scheduleQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {fuelCategories.map((fuelCategory) => {
              const row = scheduleQuery.data?.find((item) => item.fuel_category === fuelCategory)

              return (
                <div key={fuelCategory} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-medium text-slate-950">
                    {fuelCategoryLabels[fuelCategory]}
                  </p>
                  {row ? (
                    <p className="mt-1 text-sm text-slate-600">
                      {row.start_time}, {row.interval_minutes} мин., {row.vehicles_per_interval} авто
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-slate-500">Расписание не задано</p>
                  )}
                </div>
              )
            })}
          </div>
        ) : null}

        {canEdit ? (
          <Form {...form}>
            <form className="space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
              <FormItem>
                <FormLabel htmlFor="fuelingScheduleDate">Дата</FormLabel>
                <Input id="fuelingScheduleDate" type="date" {...form.register('targetDate')} />
                {form.formState.errors.targetDate ? (
                  <FormMessage>{form.formState.errors.targetDate.message}</FormMessage>
                ) : null}
              </FormItem>

              <div className="grid gap-3">
                {form.watch('schedules').map((schedule, index) => (
                  <div
                    key={schedule.fuelCategory}
                    className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_120px_140px_140px]"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {fuelCategoryLabels[schedule.fuelCategory]}
                      </p>
                      <input
                        type="hidden"
                        value={schedule.fuelCategory}
                        {...form.register(`schedules.${index}.fuelCategory`)}
                      />
                    </div>

                    <FormItem>
                      <FormLabel htmlFor={`fuelingStartTime-${schedule.fuelCategory}`}>
                        Начало
                      </FormLabel>
                      <Input
                        id={`fuelingStartTime-${schedule.fuelCategory}`}
                        type="time"
                        {...form.register(`schedules.${index}.startTime`)}
                      />
                      {form.formState.errors.schedules?.[index]?.startTime ? (
                        <FormMessage>
                          {form.formState.errors.schedules[index]?.startTime?.message}
                        </FormMessage>
                      ) : null}
                    </FormItem>

                    <FormItem>
                      <FormLabel htmlFor={`fuelingInterval-${schedule.fuelCategory}`}>
                        Интервал, мин.
                      </FormLabel>
                      <Input
                        id={`fuelingInterval-${schedule.fuelCategory}`}
                        type="number"
                        min={1}
                        max={240}
                        step={1}
                        inputMode="numeric"
                        {...form.register(`schedules.${index}.intervalMinutes`)}
                      />
                      {form.formState.errors.schedules?.[index]?.intervalMinutes ? (
                        <FormMessage>
                          {form.formState.errors.schedules[index]?.intervalMinutes?.message}
                        </FormMessage>
                      ) : null}
                    </FormItem>

                    <FormItem>
                      <FormLabel htmlFor={`fuelingCapacity-${schedule.fuelCategory}`}>
                        Авто за интервал
                      </FormLabel>
                      <Input
                        id={`fuelingCapacity-${schedule.fuelCategory}`}
                        type="number"
                        min={1}
                        max={100}
                        step={1}
                        inputMode="numeric"
                        {...form.register(`schedules.${index}.vehiclesPerInterval`)}
                      />
                      {form.formState.errors.schedules?.[index]?.vehiclesPerInterval ? (
                        <FormMessage>
                          {form.formState.errors.schedules[index]?.vehiclesPerInterval?.message}
                        </FormMessage>
                      ) : null}
                    </FormItem>
                  </div>
                ))}
              </div>

              <Button
                type="submit"
                className="h-11 w-full gap-2"
                disabled={setScheduleMutation.isPending || scheduleQuery.isLoading}
              >
                <Save className="size-4" aria-hidden="true" />
                {setScheduleMutation.isPending ? 'Сохраняем...' : 'Сохранить расписание'}
              </Button>

              {setScheduleMutation.error ? (
                <Alert variant="destructive">
                  <AlertTitle>Расписание не сохранено</AlertTitle>
                  <AlertDescription>{setScheduleMutation.error.message}</AlertDescription>
                </Alert>
              ) : null}

              {setScheduleMutation.data ? (
                <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                  <AlertTitle>Расписание сохранено</AlertTitle>
                  <AlertDescription>
                    Обновлено категорий: {setScheduleMutation.data.length}.
                  </AlertDescription>
                </Alert>
              ) : null}
            </form>
          </Form>
        ) : null}
      </CardContent>
    </Card>
  )
}
