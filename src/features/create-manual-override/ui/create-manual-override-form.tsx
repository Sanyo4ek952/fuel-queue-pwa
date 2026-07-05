import { zodResolver } from '@hookform/resolvers/zod'
import { ShieldCheck } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import { getTodayDateInputValue } from '@/shared/lib/date'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

import {
  type CreateManualOverrideFormInput,
  type CreateManualOverrideFormValues,
  createManualOverrideSchema,
} from '../model/schema'
import {
  type CreateManualOverrideMutationResult,
  useCreateManualOverride,
} from '../model/use-create-manual-override'

type CreateManualOverrideFormProps = {
  stationId: string
  plateNumber: string
  targetDate?: string
  onCreated?: (result: CreateManualOverrideMutationResult) => void
}

export function CreateManualOverrideForm({
  stationId,
  plateNumber,
  targetDate = getTodayDateInputValue(),
  onCreated,
}: CreateManualOverrideFormProps) {
  const createManualOverrideMutation = useCreateManualOverride()
  const form = useForm<CreateManualOverrideFormInput, unknown, CreateManualOverrideFormValues>({
    resolver: zodResolver(createManualOverrideSchema),
    defaultValues: {
      targetDate,
      plateNumber,
      reason: '',
      expiresAt: '',
    },
  })

  useEffect(() => {
    form.reset({
      targetDate,
      plateNumber,
      reason: form.getValues('reason'),
      expiresAt: form.getValues('expiresAt'),
    })
  }, [form, plateNumber, targetDate])

  async function handleSubmit(values: CreateManualOverrideFormValues) {
    if (!stationId) {
      return
    }

    const result = await createManualOverrideMutation.mutateAsync({
      targetDate: values.targetDate,
      stationId,
      plateNumber: values.plateNumber,
      reason: values.reason,
      expiresAt: values.expiresAt || undefined,
      clientMutationId: crypto.randomUUID(),
    })

    onCreated?.(result)
  }

  const isSubmitDisabled = !stationId || createManualOverrideMutation.isPending

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormItem>
            <FormLabel htmlFor="manualOverrideDate">Дата</FormLabel>
            <Input id="manualOverrideDate" type="date" {...form.register('targetDate')} />
            {form.formState.errors.targetDate ? (
              <FormMessage>{form.formState.errors.targetDate.message}</FormMessage>
            ) : null}
          </FormItem>
          <FormItem>
            <FormLabel htmlFor="manualOverridePlate">Госномер</FormLabel>
            <Input
              id="manualOverridePlate"
              autoComplete="off"
              inputMode="text"
              className="uppercase"
              {...form.register('plateNumber')}
            />
            {form.formState.errors.plateNumber ? (
              <FormMessage>{form.formState.errors.plateNumber.message}</FormMessage>
            ) : null}
          </FormItem>
        </div>

        <FormItem>
          <FormLabel htmlFor="manualOverrideReason">Причина</FormLabel>
          <Input id="manualOverrideReason" {...form.register('reason')} />
          {form.formState.errors.reason ? (
            <FormMessage>{form.formState.errors.reason.message}</FormMessage>
          ) : null}
        </FormItem>

        <FormItem>
          <FormLabel htmlFor="manualOverrideExpiresAt">Действует до</FormLabel>
          <Input
            id="manualOverrideExpiresAt"
            type="datetime-local"
            {...form.register('expiresAt')}
          />
          {form.formState.errors.expiresAt ? (
            <FormMessage>{form.formState.errors.expiresAt.message}</FormMessage>
          ) : null}
        </FormItem>

        <Button type="submit" className="h-11 w-full gap-2" disabled={isSubmitDisabled}>
          <ShieldCheck className="size-4" aria-hidden="true" />
          {createManualOverrideMutation.isPending ? 'Создаём разрешение...' : 'Создать ручное разрешение'}
        </Button>

        {createManualOverrideMutation.error ? (
          <Alert variant="destructive">
            <AlertTitle>Разрешение не создано</AlertTitle>
            <AlertDescription>{createManualOverrideMutation.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {createManualOverrideMutation.data ? (
          <Alert
            className={
              createManualOverrideMutation.data.sync_status === 'PENDING'
                ? 'border-amber-200 bg-amber-50 text-amber-950'
                : 'border-emerald-200 bg-emerald-50 text-emerald-950'
            }
          >
            <AlertTitle>
              {createManualOverrideMutation.data.sync_status === 'PENDING'
                ? 'Разрешение ожидает синхронизации'
                : 'Ручное разрешение создано'}
            </AlertTitle>
            <AlertDescription>
              {createManualOverrideMutation.data.normalized_plate_number},{' '}
              {createManualOverrideMutation.data.sync_status}.
            </AlertDescription>
          </Alert>
        ) : null}
      </form>
    </Form>
  )
}
