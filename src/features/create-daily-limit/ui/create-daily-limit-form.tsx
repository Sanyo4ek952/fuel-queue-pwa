import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarDays, Save } from 'lucide-react'
import { useState } from 'react'
import { useForm, type FieldPath } from 'react-hook-form'

import {
  type CreateDailyLimitFormInput,
  type CreateDailyLimitFormValues,
  createDailyLimitSchema,
  saveDailyFuelTypeLimitSchema,
  useCreateDailyLimit,
} from '@/features/create-daily-limit'
import type { DailyLimitMode, QueueFuelType } from '@/shared/constants'
import { getTodayDateInputValue } from '@/shared/lib/date'
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

const fuelTypeLabels: Record<QueueFuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
}

const defaultFuelTypeLimits = [
  { fuelType: 'AI_92' as const, limitMode: 'fuel_liters' as const, vehicleLimit: 0, litersLimit: 0 },
  { fuelType: 'AI_95' as const, limitMode: 'fuel_liters' as const, vehicleLimit: 0, litersLimit: 400 },
  { fuelType: 'AI_100' as const, limitMode: 'fuel_liters' as const, vehicleLimit: 0, litersLimit: 0 },
  { fuelType: 'DIESEL' as const, limitMode: 'fuel_liters' as const, vehicleLimit: 0, litersLimit: 400 },
  { fuelType: 'GAS' as const, limitMode: 'fuel_liters' as const, vehicleLimit: 0, litersLimit: 400 },
]

type FuelTypeLimitField = 'fuelType' | 'limitMode' | 'vehicleLimit' | 'litersLimit'

export function CreateDailyLimitForm() {
  const createDailyLimitMutation = useCreateDailyLimit()
  const [savingFuelType, setSavingFuelType] = useState<QueueFuelType | null>(null)
  const [savedFuelType, setSavedFuelType] = useState<QueueFuelType | null>(null)
  const [failedFuelType, setFailedFuelType] = useState<QueueFuelType | null>(null)
  const form = useForm<CreateDailyLimitFormInput, unknown, CreateDailyLimitFormValues>({
    resolver: zodResolver(createDailyLimitSchema),
    defaultValues: {
      targetDate: getTodayDateInputValue(),
      fuelTypeLimits: defaultFuelTypeLimits,
    },
  })
  const fuelTypeLimits = form.watch('fuelTypeLimits')

  async function handleFuelTypeSubmit(index: number) {
    const fuelTypeLimit = form.getValues(`fuelTypeLimits.${index}`)
    const fuelType = fuelTypeLimit.fuelType as QueueFuelType

    form.clearErrors()
    setSavedFuelType(null)
    setFailedFuelType(null)

    const parsed = saveDailyFuelTypeLimitSchema.safeParse({
      targetDate: form.getValues('targetDate'),
      fuelTypeLimit,
    })

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'targetDate') {
          form.setError('targetDate', { message: issue.message })
        }

        if (issue.path[0] === 'fuelTypeLimit' && typeof issue.path[1] === 'string') {
          const field = issue.path[1] as FuelTypeLimitField
          form.setError(`fuelTypeLimits.${index}.${field}` as FieldPath<CreateDailyLimitFormInput>, {
            message: issue.message,
          })
        }
      }

      return
    }

    setSavingFuelType(fuelType)

    try {
      await createDailyLimitMutation.mutateAsync({
        targetDate: parsed.data.targetDate,
        fuelTypeLimits: [parsed.data.fuelTypeLimit],
        clientMutationId: crypto.randomUUID(),
      })
      setSavedFuelType(fuelType)
    } catch {
      setFailedFuelType(fuelType)
    } finally {
      setSavingFuelType(null)
    }
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="size-5 text-slate-500" aria-hidden="true" />
          Лимит на день
        </CardTitle>
        <CardDescription>
          Мэр задаёт дневной лимит по точным маркам топлива для единой очереди.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
            <FormItem>
              <FormLabel htmlFor="targetDate">Дата</FormLabel>
              <Input id="targetDate" type="date" {...form.register('targetDate')} />
              {form.formState.errors.targetDate ? (
                <FormMessage>{form.formState.errors.targetDate.message}</FormMessage>
              ) : null}
            </FormItem>

            <div className="grid gap-3">
              {fuelTypeLimits.map((item, index) => {
                const mode = item.limitMode as DailyLimitMode
                const fuelType = item.fuelType as QueueFuelType
                const isSaving = savingFuelType === fuelType
                const isSaved = savedFuelType === fuelType
                const isFailed = failedFuelType === fuelType

                return (
                  <div
                    key={fuelType}
                    className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_160px_140px_140px]"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {fuelTypeLabels[fuelType]}
                      </p>
                      <input
                        type="hidden"
                        value={fuelType}
                        {...form.register(`fuelTypeLimits.${index}.fuelType`)}
                      />
                    </div>

                    <FormItem>
                      <FormLabel htmlFor={`limitMode-${fuelType}`}>Режим</FormLabel>
                      <Select
                        value={mode}
                        onValueChange={(value) =>
                          form.setValue(`fuelTypeLimits.${index}.limitMode`, value as DailyLimitMode, {
                            shouldValidate: true,
                          })
                        }
                      >
                        <SelectTrigger id={`limitMode-${fuelType}`} className="h-10 w-full bg-white">
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
                        <FormLabel htmlFor={`vehicleLimit-${fuelType}`}>Машин</FormLabel>
                        <Input
                          id={`vehicleLimit-${fuelType}`}
                          type="number"
                          min={1}
                          inputMode="numeric"
                          {...form.register(`fuelTypeLimits.${index}.vehicleLimit`)}
                        />
                        {form.formState.errors.fuelTypeLimits?.[index]?.vehicleLimit ? (
                          <FormMessage>
                            {form.formState.errors.fuelTypeLimits[index]?.vehicleLimit?.message}
                          </FormMessage>
                        ) : null}
                      </FormItem>
                    ) : (
                      <FormItem>
                        <FormLabel htmlFor={`litersLimit-${fuelType}`}>Литров</FormLabel>
                        <Input
                          id={`litersLimit-${fuelType}`}
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          {...form.register(`fuelTypeLimits.${index}.litersLimit`)}
                        />
                        {form.formState.errors.fuelTypeLimits?.[index]?.litersLimit ? (
                          <FormMessage>
                            {form.formState.errors.fuelTypeLimits[index]?.litersLimit?.message}
                          </FormMessage>
                        ) : null}
                      </FormItem>
                    )}

                    <div className="flex flex-col justify-end gap-2">
                      <Button
                        type="button"
                        className="h-10 w-full gap-2"
                        aria-label={`Сохранить ${fuelTypeLabels[fuelType]}`}
                        disabled={createDailyLimitMutation.isPending}
                        onClick={() => void handleFuelTypeSubmit(index)}
                      >
                        <Save className="size-4" aria-hidden="true" />
                        {isSaving ? 'Сохраняем...' : 'Сохранить'}
                      </Button>

                      {isSaved && createDailyLimitMutation.data ? (
                        <p className="text-xs font-medium text-emerald-700">Лимит сохранён</p>
                      ) : null}

                      {isFailed && createDailyLimitMutation.error ? (
                        <p className="text-xs font-medium text-destructive">
                          {createDailyLimitMutation.error.message}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
