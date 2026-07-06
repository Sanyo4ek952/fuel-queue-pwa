import { zodResolver } from '@hookform/resolvers/zod'
import { Gauge, Save } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'

import { PlateNumberInput } from '@/entities/vehicle'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

import {
  type CreatePersonalVehicleLiterLimitFormInput,
  type CreatePersonalVehicleLiterLimitFormValues,
  createPersonalVehicleLiterLimitSchema,
} from '../model/schema'
import { useCreatePersonalVehicleLiterLimit } from '../model/use-create-personal-vehicle-liter-limit'

export function CreatePersonalVehicleLiterLimitForm() {
  const mutation = useCreatePersonalVehicleLiterLimit()
  const form = useForm<
    CreatePersonalVehicleLiterLimitFormInput,
    unknown,
    CreatePersonalVehicleLiterLimitFormValues
  >({
    resolver: zodResolver(createPersonalVehicleLiterLimitSchema),
    mode: 'onBlur',
    defaultValues: {
      targetDate: getTodayDateInputValue(),
      plateNumber: '',
      liters: 20,
      comment: '',
    },
  })

  async function handleSubmit(values: CreatePersonalVehicleLiterLimitFormValues) {
    await mutation.mutateAsync({
      targetDate: values.targetDate,
      plateNumber: values.plateNumber,
      liters: values.liters,
      comment: values.comment,
      clientMutationId: crypto.randomUUID(),
    })
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-5 text-slate-500" aria-hidden="true" />
          Литры для отдельного номера
        </CardTitle>
        <CardDescription>
          Этот объём заменяет обычную заявку при расчёте, на ком закончится топливо.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="grid gap-4 sm:grid-cols-[160px_1fr_140px]">
              <FormItem>
                <FormLabel htmlFor="personal-targetDate">Дата</FormLabel>
                <Input id="personal-targetDate" type="date" {...form.register('targetDate')} />
                {form.formState.errors.targetDate ? (
                  <FormMessage>{form.formState.errors.targetDate.message}</FormMessage>
                ) : null}
              </FormItem>

              <FormItem>
                <FormLabel htmlFor="personal-plateNumber">Госномер</FormLabel>
                <Controller
                  control={form.control}
                  name="plateNumber"
                  render={({ field }) => (
                    <PlateNumberInput
                      id="personal-plateNumber"
                      className="uppercase"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  )}
                />
                {form.formState.errors.plateNumber ? (
                  <FormMessage>{form.formState.errors.plateNumber.message}</FormMessage>
                ) : null}
              </FormItem>

              <FormItem>
                <FormLabel htmlFor="personal-liters">Литров</FormLabel>
                <Input
                  id="personal-liters"
                  type="number"
                  min={1}
                  step="0.01"
                  inputMode="decimal"
                  {...form.register('liters')}
                />
                {form.formState.errors.liters ? (
                  <FormMessage>{form.formState.errors.liters.message}</FormMessage>
                ) : null}
              </FormItem>
            </div>

            <FormItem>
              <FormLabel htmlFor="personal-comment">Комментарий</FormLabel>
              <Input id="personal-comment" {...form.register('comment')} />
              {form.formState.errors.comment ? (
                <FormMessage>{form.formState.errors.comment.message}</FormMessage>
              ) : null}
            </FormItem>

            <Button type="submit" className="h-11 w-full gap-2" disabled={mutation.isPending}>
              <Save className="size-4" aria-hidden="true" />
              {mutation.isPending ? 'Сохраняем...' : 'Сохранить литры'}
            </Button>

            {mutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Лимит номера не сохранён</AlertTitle>
                <AlertDescription>{mutation.error.message}</AlertDescription>
              </Alert>
            ) : null}

            {mutation.data ? (
              <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                <AlertTitle>Лимит номера сохранён</AlertTitle>
                <AlertDescription>
                  {mutation.data.normalized_plate_number}: {mutation.data.liters} л.
                </AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
