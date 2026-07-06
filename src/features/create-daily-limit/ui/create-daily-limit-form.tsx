import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarDays, Save } from 'lucide-react'
import { useForm } from 'react-hook-form'

import {
  type CreateDailyLimitFormInput,
  type CreateDailyLimitFormValues,
  createDailyLimitSchema,
  useCreateDailyLimit,
} from '@/features/create-daily-limit'
import type { DailyLimitMode, FuelQueueCategory } from '@/shared/constants'
import { getTodayDateInputValue } from '@/shared/lib/date'
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

const categoryLabels: Record<FuelQueueCategory, string> = {
  GASOLINE: 'Бензин',
  DIESEL: 'Дизель',
  GAS: 'Газ',
}

const defaultCategoryLimits = [
  { fuelCategory: 'GASOLINE' as const, limitMode: 'fuel_liters' as const, vehicleLimit: 0, litersLimit: 400 },
  { fuelCategory: 'DIESEL' as const, limitMode: 'fuel_liters' as const, vehicleLimit: 0, litersLimit: 400 },
  { fuelCategory: 'GAS' as const, limitMode: 'fuel_liters' as const, vehicleLimit: 0, litersLimit: 400 },
]

export function CreateDailyLimitForm() {
  const createDailyLimitMutation = useCreateDailyLimit()
  const form = useForm<CreateDailyLimitFormInput, unknown, CreateDailyLimitFormValues>({
    resolver: zodResolver(createDailyLimitSchema),
    defaultValues: {
      targetDate: getTodayDateInputValue(),
      categoryLimits: defaultCategoryLimits,
    },
  })
  const categoryLimits = form.watch('categoryLimits')

  async function handleSubmit(values: CreateDailyLimitFormValues) {
    await createDailyLimitMutation.mutateAsync({
      targetDate: values.targetDate,
      categoryLimits: values.categoryLimits,
      clientMutationId: crypto.randomUUID(),
    })
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="size-5 text-slate-500" aria-hidden="true" />
          Лимит на день
        </CardTitle>
        <CardDescription>
          Мэр задаёт общий дневной лимит по бензину, дизелю и газу для единой очереди.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
            <FormItem>
              <FormLabel htmlFor="targetDate">Дата</FormLabel>
              <Input id="targetDate" type="date" {...form.register('targetDate')} />
              {form.formState.errors.targetDate ? (
                <FormMessage>{form.formState.errors.targetDate.message}</FormMessage>
              ) : null}
            </FormItem>

            <div className="grid gap-3">
              {categoryLimits.map((item, index) => {
                const mode = item.limitMode as DailyLimitMode
                const fuelCategory = item.fuelCategory as FuelQueueCategory

                return (
                  <div
                    key={fuelCategory}
                    className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_160px_140px]"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {categoryLabels[fuelCategory]}
                      </p>
                      <input
                        type="hidden"
                        value={fuelCategory}
                        {...form.register(`categoryLimits.${index}.fuelCategory`)}
                      />
                    </div>

                    <FormItem>
                      <FormLabel htmlFor={`limitMode-${fuelCategory}`}>Режим</FormLabel>
                      <Select
                        value={mode}
                        onValueChange={(value) =>
                          form.setValue(`categoryLimits.${index}.limitMode`, value as DailyLimitMode, {
                            shouldValidate: true,
                          })
                        }
                      >
                        <SelectTrigger id={`limitMode-${fuelCategory}`} className="h-10 w-full bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" align="start">
                          <SelectItem value="fuel_liters">Литры</SelectItem>
                          <SelectItem value="vehicle_count">Машины</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>

                    {mode === 'vehicle_count' ? (
                      <FormItem>
                        <FormLabel htmlFor={`vehicleLimit-${fuelCategory}`}>Машин</FormLabel>
                        <Input
                          id={`vehicleLimit-${fuelCategory}`}
                          type="number"
                          min={1}
                          inputMode="numeric"
                          {...form.register(`categoryLimits.${index}.vehicleLimit`)}
                        />
                        {form.formState.errors.categoryLimits?.[index]?.vehicleLimit ? (
                          <FormMessage>
                            {form.formState.errors.categoryLimits[index]?.vehicleLimit?.message}
                          </FormMessage>
                        ) : null}
                      </FormItem>
                    ) : (
                      <FormItem>
                        <FormLabel htmlFor={`litersLimit-${fuelCategory}`}>Литров</FormLabel>
                        <Input
                          id={`litersLimit-${fuelCategory}`}
                          type="number"
                          min={1}
                          step="0.01"
                          inputMode="decimal"
                          {...form.register(`categoryLimits.${index}.litersLimit`)}
                        />
                        {form.formState.errors.categoryLimits?.[index]?.litersLimit ? (
                          <FormMessage>
                            {form.formState.errors.categoryLimits[index]?.litersLimit?.message}
                          </FormMessage>
                        ) : null}
                      </FormItem>
                    )}
                  </div>
                )
              })}
            </div>

            <Button
              type="submit"
              className="h-11 w-full gap-2"
              disabled={createDailyLimitMutation.isPending}
            >
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
                  Дата {createDailyLimitMutation.data.date}, категорий:{' '}
                  {createDailyLimitMutation.data.category_limits?.length ?? 0}.
                </AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
