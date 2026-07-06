import { zodResolver } from '@hookform/resolvers/zod'
import { PlusCircle } from 'lucide-react'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { PlateNumberInput } from '@/entities/vehicle'
import { QUEUE_FUEL_TYPES, type FuelType, type QueueFuelType } from '@/shared/constants'
import type { PreferentialQueue } from '@/shared/api/preferential-queues'
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

import {
  type CreatePreferentialQueueEntryFormInput,
  type CreatePreferentialQueueEntryFormValues,
  createPreferentialQueueEntrySchema,
} from '../model/schema'
import { useCreatePreferentialQueueEntry } from '../model/use-create-preferential-queue-entry'

const fuelTypeLabels: Record<FuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
  OTHER: 'Другое',
}

export function CreatePreferentialQueueEntryForm({
  queues = [],
  queueId,
  queueName,
  onSuccess,
}: {
  queues?: PreferentialQueue[]
  queueId?: string
  queueName?: string
  onSuccess?: () => void
}) {
  const createEntryMutation = useCreatePreferentialQueueEntry()
  const initialQueueId = queueId ?? queues[0]?.id ?? ''
  const form = useForm<
    CreatePreferentialQueueEntryFormInput,
    unknown,
    CreatePreferentialQueueEntryFormValues
  >({
    resolver: zodResolver(createPreferentialQueueEntrySchema),
    mode: 'onBlur',
    defaultValues: {
      queueId: initialQueueId,
      plateNumber: '',
      driverFullName: '',
      driverPhone: '',
      fuelType: 'AI_95',
      requestedLiters: 40,
      comment: '',
    },
  })
  const selectedQueueId = form.watch('queueId')
  const isQueueFixed = Boolean(queueId)

  useEffect(() => {
    if (queueId && selectedQueueId !== queueId) {
      form.setValue('queueId', queueId, { shouldValidate: true })
      return
    }

    if (!queueId && !selectedQueueId && queues[0]?.id) {
      form.setValue('queueId', queues[0].id, { shouldValidate: true })
    }
  }, [form, queueId, queues, selectedQueueId])

  async function handleSubmit(values: CreatePreferentialQueueEntryFormValues) {
    const nextQueueId = queueId ?? values.queueId

    await createEntryMutation.mutateAsync({
      queueId: nextQueueId,
      plateNumber: values.plateNumber,
      driverFullName: values.driverFullName,
      driverPhone: values.driverPhone,
      fuelType: values.fuelType,
      requestedLiters: values.requestedLiters,
      comment: values.comment,
      clientMutationId: crypto.randomUUID(),
    })
    form.reset({
      queueId: nextQueueId,
      plateNumber: '',
      driverFullName: '',
      driverPhone: '',
      fuelType: values.fuelType,
      requestedLiters: values.requestedLiters,
      comment: '',
    })
    onSuccess?.()
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlusCircle className="size-5 text-slate-500" aria-hidden="true" />
          Добавить машину
        </CardTitle>
        <CardDescription>
          Льготная заявка действует до заправки или отмены и не занимает дневной лимит.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(handleSubmit)}>
            {isQueueFixed ? (
              <input type="hidden" {...form.register('queueId')} value={queueId} />
            ) : (
              <FormItem>
                <FormLabel htmlFor="preferentialQueueId">Льготная очередь</FormLabel>
                <Select
                  value={form.watch('queueId')}
                  onValueChange={(value) =>
                    form.setValue('queueId', value, { shouldValidate: true })
                  }
                  disabled={queues.length === 0}
                >
                  <SelectTrigger id="preferentialQueueId" className="h-10 w-full bg-white">
                    <SelectValue placeholder="Выберите очередь" />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    {queues.map((queue) => (
                      <SelectItem key={queue.id} value={queue.id}>
                        {queue.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.queueId ? (
                  <FormMessage>{form.formState.errors.queueId.message}</FormMessage>
                ) : null}
              </FormItem>
            )}

            {queueName ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Очередь: <span className="font-medium text-slate-950">{queueName}</span>
              </p>
            ) : null}

            <FormItem>
              <FormLabel htmlFor="preferentialPlateNumber">Госномер</FormLabel>
              <Controller
                control={form.control}
                name="plateNumber"
                render={({ field }) => (
                  <PlateNumberInput
                    id="preferentialPlateNumber"
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

            <div className="grid gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="preferentialDriverFullName">Водитель</FormLabel>
                <Input
                  id="preferentialDriverFullName"
                  autoComplete="name"
                  {...form.register('driverFullName')}
                />
                {form.formState.errors.driverFullName ? (
                  <FormMessage>{form.formState.errors.driverFullName.message}</FormMessage>
                ) : null}
              </FormItem>
              <FormItem>
                <FormLabel htmlFor="preferentialDriverPhone">Телефон</FormLabel>
                <Input
                  id="preferentialDriverPhone"
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
                <FormLabel htmlFor="preferentialFuelType">Топливо</FormLabel>
                <Select
                  value={form.watch('fuelType')}
                  onValueChange={(value) =>
                    form.setValue('fuelType', value as QueueFuelType, { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="preferentialFuelType" className="h-10 w-full bg-white">
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
                <FormLabel htmlFor="preferentialRequestedLiters">Литры</FormLabel>
                <Input
                  id="preferentialRequestedLiters"
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
              <FormLabel htmlFor="preferentialComment">Комментарий</FormLabel>
              <Input id="preferentialComment" {...form.register('comment')} />
              {form.formState.errors.comment ? (
                <FormMessage>{form.formState.errors.comment.message}</FormMessage>
              ) : null}
            </FormItem>

            <Button
              type="submit"
              className="h-11 w-full gap-2"
              disabled={(!queueId && queues.length === 0) || createEntryMutation.isPending}
            >
              <PlusCircle className="size-4" aria-hidden="true" />
              {createEntryMutation.isPending ? 'Добавляем...' : 'Добавить в очередь'}
            </Button>

            {createEntryMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Машина не добавлена</AlertTitle>
                <AlertDescription>{createEntryMutation.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
