import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarX2, Clock3, Save } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import {
  type NoShowGraceFormInput,
  type NoShowGraceFormValues,
  type RefuelCooldownFormInput,
  type RefuelCooldownFormValues,
  noShowGraceSchema,
  refuelCooldownSchema,
} from '../model/schema'
import {
  useNoShowGrace,
  useRefuelCooldown,
  useSetNoShowGrace,
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

function formatDays(days: number) {
  return days === 0 ? 'не ограничено' : `${days} дн.`
}

export function RefuelCooldownSettingsCard({ canEdit }: RefuelCooldownSettingsCardProps) {
  const cooldownQuery = useRefuelCooldown()
  const noShowGraceQuery = useNoShowGrace()
  const setCooldownMutation = useSetRefuelCooldown()
  const setNoShowGraceMutation = useSetNoShowGrace()
  const cooldownForm = useForm<RefuelCooldownFormInput, unknown, RefuelCooldownFormValues>({
    resolver: zodResolver(refuelCooldownSchema),
    defaultValues: {
      days: 0,
    },
  })
  const noShowGraceForm = useForm<NoShowGraceFormInput, unknown, NoShowGraceFormValues>({
    resolver: zodResolver(noShowGraceSchema),
    defaultValues: {
      days: 0,
    },
  })

  useEffect(() => {
    if (cooldownQuery.data) {
      cooldownForm.reset({ days: cooldownQuery.data.days })
    }
  }, [cooldownQuery.data, cooldownForm])

  useEffect(() => {
    if (noShowGraceQuery.data) {
      noShowGraceForm.reset({ days: noShowGraceQuery.data.days })
    }
  }, [noShowGraceQuery.data, noShowGraceForm])

  async function handleCooldownSubmit(values: RefuelCooldownFormValues) {
    await setCooldownMutation.mutateAsync({
      days: values.days,
      clientMutationId: crypto.randomUUID(),
    })
  }

  async function handleNoShowGraceSubmit(values: NoShowGraceFormValues) {
    await setNoShowGraceMutation.mutateAsync({
      days: values.days,
      clientMutationId: crypto.randomUUID(),
    })
  }

  const currentCooldownDays = cooldownQuery.data?.days ?? 0
  const currentNoShowGraceDays = noShowGraceQuery.data?.days ?? 0

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock3 className="size-5 text-slate-500" aria-hidden="true" />
          Правила очереди
        </CardTitle>
        <CardDescription>
          Глобальные настройки повторной записи и автоматического исключения из очереди.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {cooldownQuery.isLoading || noShowGraceQuery.isLoading ? (
          <p className="text-sm text-slate-500">Загружаем настройки...</p>
        ) : null}

        {cooldownQuery.error ? (
          <Alert variant="destructive">
            <AlertTitle>Интервал не загружен</AlertTitle>
            <AlertDescription>{cooldownQuery.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {noShowGraceQuery.error ? (
          <Alert variant="destructive">
            <AlertTitle>Лимит пропусков не загружен</AlertTitle>
            <AlertDescription>{noShowGraceQuery.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {!canEdit && !cooldownQuery.isLoading && !noShowGraceQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Интервал между заправками</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">
                {formatDays(currentCooldownDays)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Пропусков до исключения</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">
                {formatDays(currentNoShowGraceDays)}
              </p>
            </div>
          </div>
        ) : null}

        {canEdit ? (
          <div className="space-y-6">
            <Form {...cooldownForm}>
              <form className="space-y-4" onSubmit={cooldownForm.handleSubmit(handleCooldownSubmit)}>
                <FormItem>
                  <FormLabel htmlFor="refuelCooldownDays">
                    Через сколько дней можно снова в очередь
                  </FormLabel>
                  <Input
                    id="refuelCooldownDays"
                    type="number"
                    min={0}
                    max={3650}
                    step={1}
                    inputMode="numeric"
                    {...cooldownForm.register('days')}
                  />
                  {cooldownForm.formState.errors.days ? (
                    <FormMessage>{cooldownForm.formState.errors.days.message}</FormMessage>
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
                    <AlertTitle>Интервал не сохранен</AlertTitle>
                    <AlertDescription>{setCooldownMutation.error.message}</AlertDescription>
                  </Alert>
                ) : null}

                {setCooldownMutation.data ? (
                  <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                    <AlertTitle>Интервал сохранен</AlertTitle>
                    <AlertDescription>
                      Новые заявки будут проверяться по интервалу{' '}
                      {formatDays(setCooldownMutation.data.days)}.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </form>
            </Form>

            <div className="border-t border-slate-200 pt-6">
              <Form {...noShowGraceForm}>
                <form
                  className="space-y-4"
                  onSubmit={noShowGraceForm.handleSubmit(handleNoShowGraceSubmit)}
                >
                  <FormItem>
                    <FormLabel
                      htmlFor="noShowGraceDays"
                      className="flex items-center gap-2"
                    >
                      <CalendarX2 className="size-4 text-slate-500" aria-hidden="true" />
                      Сколько дней можно пропустить заправку
                    </FormLabel>
                    <Input
                      id="noShowGraceDays"
                      type="number"
                      min={0}
                      max={3650}
                      step={1}
                      inputMode="numeric"
                      {...noShowGraceForm.register('days')}
                    />
                    {noShowGraceForm.formState.errors.days ? (
                      <FormMessage>{noShowGraceForm.formState.errors.days.message}</FormMessage>
                    ) : null}
                  </FormItem>

                  <Button
                    type="submit"
                    className="h-11 w-full gap-2"
                    disabled={setNoShowGraceMutation.isPending || noShowGraceQuery.isLoading}
                  >
                    <Save className="size-4" aria-hidden="true" />
                    {setNoShowGraceMutation.isPending
                      ? 'Сохраняем...'
                      : 'Сохранить лимит пропусков'}
                  </Button>

                  {setNoShowGraceMutation.error ? (
                    <Alert variant="destructive">
                      <AlertTitle>Лимит пропусков не сохранен</AlertTitle>
                      <AlertDescription>{setNoShowGraceMutation.error.message}</AlertDescription>
                    </Alert>
                  ) : null}

                  {setNoShowGraceMutation.data ? (
                    <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                      <AlertTitle>Лимит пропусков сохранен</AlertTitle>
                      <AlertDescription>
                        {setNoShowGraceMutation.data.days === 0
                          ? 'Автоматическое исключение из очереди отключено.'
                          : `После ${setNoShowGraceMutation.data.days} покрытых пропусков подряд запись станет NO_SHOW.`}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </form>
              </Form>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
