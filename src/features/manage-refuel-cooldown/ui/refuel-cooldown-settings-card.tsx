import { zodResolver } from '@hookform/resolvers/zod'
import { Clock3, Save } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import {
  type RefuelCooldownFormInput,
  type RefuelCooldownFormValues,
  refuelCooldownSchema,
} from '../model/schema'
import {
  useRefuelCooldown,
  useSetRefuelCooldown,
} from '../model/use-refuel-cooldown'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

type RefuelCooldownSettingsCardProps = {
  canEdit: boolean
}

export function RefuelCooldownSettingsCard({ canEdit }: RefuelCooldownSettingsCardProps) {
  const cooldownQuery = useRefuelCooldown()
  const setCooldownMutation = useSetRefuelCooldown()
  const form = useForm<RefuelCooldownFormInput, unknown, RefuelCooldownFormValues>({
    resolver: zodResolver(refuelCooldownSchema),
    defaultValues: {
      days: 0,
    },
  })

  useEffect(() => {
    if (cooldownQuery.data) {
      form.reset({ days: cooldownQuery.data.days })
    }
  }, [cooldownQuery.data, form])

  async function handleSubmit(values: RefuelCooldownFormValues) {
    await setCooldownMutation.mutateAsync({
      days: values.days,
      clientMutationId: crypto.randomUUID(),
    })
  }

  const currentDays = cooldownQuery.data?.days ?? 0

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock3 className="size-5 text-slate-500" aria-hidden="true" />
          Интервал между заправками
        </CardTitle>
        <CardDescription>
          Глобальное правило для новой записи автомобиля в общую очередь.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {cooldownQuery.isLoading ? (
          <p className="text-sm text-slate-500">Загружаем настройку...</p>
        ) : null}

        {cooldownQuery.error ? (
          <Alert variant="destructive">
            <AlertTitle>Настройка не загружена</AlertTitle>
            <AlertDescription>{cooldownQuery.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {!canEdit && !cooldownQuery.isLoading && !cooldownQuery.error ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Текущее значение</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{currentDays} дн.</p>
          </div>
        ) : null}

        {canEdit ? (
          <Form {...form}>
            <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
              <FormItem>
                <FormLabel htmlFor="refuelCooldownDays">Через сколько дней можно снова в очередь</FormLabel>
                <Input
                  id="refuelCooldownDays"
                  type="number"
                  min={0}
                  max={3650}
                  step={1}
                  inputMode="numeric"
                  {...form.register('days')}
                />
                {form.formState.errors.days ? (
                  <FormMessage>{form.formState.errors.days.message}</FormMessage>
                ) : null}
              </FormItem>

              <Button
                type="submit"
                className="h-11 w-full gap-2"
                disabled={setCooldownMutation.isPending || cooldownQuery.isLoading}
              >
                <Save className="size-4" aria-hidden="true" />
                {setCooldownMutation.isPending ? 'Сохраняем...' : 'Сохранить интервал'}
              </Button>

              {setCooldownMutation.error ? (
                <Alert variant="destructive">
                  <AlertTitle>Интервал не сохранён</AlertTitle>
                  <AlertDescription>{setCooldownMutation.error.message}</AlertDescription>
                </Alert>
              ) : null}

              {setCooldownMutation.data ? (
                <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                  <AlertTitle>Интервал сохранён</AlertTitle>
                  <AlertDescription>
                    Новые заявки будут проверяться по интервалу {setCooldownMutation.data.days} дн.
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
