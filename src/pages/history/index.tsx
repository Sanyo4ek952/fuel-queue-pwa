import { zodResolver } from '@hookform/resolvers/zod'
import { Search } from 'lucide-react'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useSearchParams } from 'react-router-dom'

import { PlateNumberInput } from '@/entities/vehicle'
import {
  type CheckVehicleFormInput,
  type CheckVehicleFormValues,
  buildVehicleFuelingHistoryViewResult,
  checkVehicleSchema,
  useVehicleFuelingHistory,
  VehicleFuelingHistoryPanel,
} from '@/features/check-vehicle'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'

const HISTORY_PAGE_SIZE = 10

export function HistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const plateNumberFromUrl = normalizePlateNumber(searchParams.get('plate') ?? '')
  const form = useForm<CheckVehicleFormInput, unknown, CheckVehicleFormValues>({
    resolver: zodResolver(checkVehicleSchema),
    mode: 'onBlur',
    defaultValues: {
      plateNumber: plateNumberFromUrl,
    },
  })
  const vehicleFuelingHistoryQuery = useVehicleFuelingHistory({
    plateNumber: plateNumberFromUrl,
    enabled: Boolean(plateNumberFromUrl),
    pageSize: HISTORY_PAGE_SIZE,
  })
  const fuelingHistoryViewResult = buildVehicleFuelingHistoryViewResult(
    vehicleFuelingHistoryQuery.data,
  )

  useEffect(() => {
    form.reset({ plateNumber: plateNumberFromUrl })
  }, [form, plateNumberFromUrl])

  function handleSubmit(values: CheckVehicleFormValues) {
    setSearchParams({ plate: normalizePlateNumber(values.plateNumber) })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">История заправок</h1>
        <p className="mt-1 text-sm text-slate-500">
          Поиск по госномеру и просмотр последних заправок с дозагрузкой по 10 записей.
        </p>
      </div>

      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle>Поиск автомобиля</CardTitle>
          <CardDescription>Введите госномер, чтобы открыть историю по всем 3 АЗС.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="space-y-3" onSubmit={form.handleSubmit(handleSubmit)}>
              <FormItem>
                <FormLabel htmlFor="historyPlateNumber">Госномер</FormLabel>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Controller
                    control={form.control}
                    name="plateNumber"
                    render={({ field }) => (
                      <PlateNumberInput
                        id="historyPlateNumber"
                        className="uppercase"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    )}
                  />
                  <Button type="submit" className="h-10 shrink-0 gap-2">
                    <Search className="size-4" aria-hidden="true" />
                    Найти
                  </Button>
                </div>
                {form.formState.errors.plateNumber ? (
                  <FormMessage>{form.formState.errors.plateNumber.message}</FormMessage>
                ) : null}
              </FormItem>
            </form>
          </Form>
        </CardContent>
      </Card>

      {plateNumberFromUrl ? (
        <VehicleFuelingHistoryPanel
          result={fuelingHistoryViewResult}
          isLoading={vehicleFuelingHistoryQuery.isLoading}
          isError={vehicleFuelingHistoryQuery.isError}
          isFetchingNextPage={vehicleFuelingHistoryQuery.isFetchingNextPage}
          hasNextPage={vehicleFuelingHistoryQuery.hasNextPage}
          onLoadMore={() => {
            void vehicleFuelingHistoryQuery.fetchNextPage()
          }}
        />
      ) : null}
    </div>
  )
}
