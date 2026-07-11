import { zodResolver } from '@hookform/resolvers/zod'
import { Fuel, Save } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import {
  residentFuelNormSchema,
  type ResidentFuelNormFormInput,
  type ResidentFuelNormFormValues,
} from '../model/schema'
import { useResidentFuelNorm, useSetResidentFuelNorm } from '../model/use-resident-fuel-norm'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

type ResidentFuelNormSettingsCardProps = {
  canEdit: boolean
}

function formatLiters(liters: number) {
  return `${liters} л`
}

export function ResidentFuelNormSettingsCard({ canEdit }: ResidentFuelNormSettingsCardProps) {
  const normQuery = useResidentFuelNorm()
  const setNormMutation = useSetResidentFuelNorm()
  const form = useForm<ResidentFuelNormFormInput, unknown, ResidentFuelNormFormValues>({
    resolver: zodResolver(residentFuelNormSchema),
    defaultValues: {
      liters: 20,
    },
  })

  useEffect(() => {
    if (normQuery.data) {
      form.reset({ liters: normQuery.data.liters })
    }
  }, [form, normQuery.data])

  async function handleSubmit(values: ResidentFuelNormFormValues) {
    await setNormMutation.mutateAsync({
      liters: values.liters,
      clientMutationId: crypto.randomUUID(),
    })
  }

  const currentLiters = normQuery.data?.liters ?? 20

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fuel className="size-5 text-slate-500" aria-hidden="true" />
          Норма для жителей
        </CardTitle>
        <CardDescription>
          Единое количество литров, которое получает житель при записи из личного кабинета.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {normQuery.isLoading ? (
          <p className="text-sm text-slate-500">Загружаем норму...</p>
        ) : null}

        {normQuery.error ? (
          <Alert variant="destructive">
            <AlertTitle>Норма не загружена</AlertTitle>
            <AlertDescription>{normQuery.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {!canEdit && !normQuery.isLoading ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Текущая норма</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">
              {formatLiters(currentLiters)}
            </p>
          </div>
        ) : null}

        {canEdit ? (
          <Form {...form}>
            <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
              <FormItem>
                <FormLabel htmlFor="residentFuelNormLiters">Литры на одного жителя</FormLabel>
                <Input
                  id="residentFuelNormLiters"
                  type="number"
                  min={0.01}
                  max={1000}
                  step="0.01"
                  inputMode="decimal"
                  {...form.register('liters')}
                />
                {form.formState.errors.liters ? (
                  <FormMessage>{form.formState.errors.liters.message}</FormMessage>
                ) : null}
              </FormItem>

              <Button
                type="submit"
                className="h-11 w-full gap-2"
                disabled={setNormMutation.isPending || normQuery.isLoading}
              >
                <Save className="size-4" aria-hidden="true" />
                {setNormMutation.isPending ? 'Сохраняем...' : 'Сохранить норму'}
              </Button>

              {setNormMutation.error ? (
                <Alert variant="destructive">
                  <AlertTitle>Норма не сохранена</AlertTitle>
                  <AlertDescription>{setNormMutation.error.message}</AlertDescription>
                </Alert>
              ) : null}

              {setNormMutation.data ? (
                <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
                  <AlertTitle>Норма сохранена</AlertTitle>
                  <AlertDescription>
                    Новые записи жителей будут создаваться на{' '}
                    {formatLiters(setNormMutation.data.liters)}.
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
