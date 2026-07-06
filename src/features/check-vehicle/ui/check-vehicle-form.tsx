import { zodResolver } from '@hookform/resolvers/zod'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { useCurrentProfile } from '@/entities/profile'
import { PlateNumberInput } from '@/entities/vehicle'
import {
  type CheckVehicleFormInput,
  type CheckVehicleFormValues,
  buildVehicleFuelingHistoryViewResult,
  checkVehicleSchema,
  useCheckVehicleAccess,
  useVehicleFuelingHistory,
  VehicleAccessResultView,
  VehicleFuelingHistoryAccordion,
} from '@/features/check-vehicle'
import { CreateManualOverrideForm } from '@/features/create-manual-override'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { canCreateManualOverride } from '@/shared/lib/permissions'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
import { useProfileStationSelection } from '@/shared/lib/station-selection'
import { Button } from '@/shared/ui/button'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { StationSelectField } from '@/shared/ui/station-select-field'

const HISTORY_ACCORDION_VALUE = 'fueling-history'

export function CheckVehicleForm() {
  const currentProfileQuery = useCurrentProfile()
  const currentProfile = currentProfileQuery.data
  const stations = currentProfile?.stations ?? []
  const [selectedStationId, setSelectedStationId] = useProfileStationSelection(stations)
  const [historyPlateNumber, setHistoryPlateNumber] = useState('')
  const [historyAccordionValue, setHistoryAccordionValue] = useState<string | undefined>()
  const checkVehicleAccessMutation = useCheckVehicleAccess()
  const isHistoryOpen = historyAccordionValue === HISTORY_ACCORDION_VALUE
  const vehicleFuelingHistoryQuery = useVehicleFuelingHistory({
    plateNumber: historyPlateNumber,
    enabled: isHistoryOpen,
  })
  const form = useForm<CheckVehicleFormInput, unknown, CheckVehicleFormValues>({
    resolver: zodResolver(checkVehicleSchema),
    mode: 'onBlur',
    defaultValues: {
      plateNumber: '',
    },
  })

  async function handleSubmit(values: CheckVehicleFormValues) {
    setHistoryPlateNumber(values.plateNumber)
    setHistoryAccordionValue(undefined)

    if (!selectedStationId) {
      checkVehicleAccessMutation.reset()
      return
    }

    await checkVehicleAccessMutation.mutateAsync({
      plateNumber: values.plateNumber,
      stationId: selectedStationId,
      checkDate: getTodayDateInputValue(),
    })
  }

  const accessResult = checkVehicleAccessMutation.data
  const fuelingHistoryViewResult = buildVehicleFuelingHistoryViewResult(
    vehicleFuelingHistoryQuery.data,
  )
  const canShowManualOverride =
    Boolean(
      selectedStationId &&
        accessResult &&
        currentProfile &&
        canCreateManualOverride(currentProfile.role),
    ) &&
    (accessResult?.status === 'BLOCKED' || accessResult?.offline_decision === 'BLOCKED') &&
    accessResult?.reason !== 'MANUAL_OVERRIDE_ACTIVE'

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
        <StationSelectField
          id="checkStationId"
          value={selectedStationId}
          stations={stations}
          onValueChange={setSelectedStationId}
          emptyMessage="АЗС не назначена. Проверка недоступна."
        />
        <FormItem>
          <FormLabel htmlFor="plateNumber">Госномер</FormLabel>
          <Controller
            control={form.control}
            name="plateNumber"
            render={({ field }) => (
              <PlateNumberInput
                id="plateNumber"
                className="h-12 text-lg uppercase"
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
        <Button
          type="submit"
          className="h-11 w-full gap-2"
          disabled={!selectedStationId || checkVehicleAccessMutation.isPending}
        >
          <Search className="size-4" aria-hidden="true" />
          {checkVehicleAccessMutation.isPending ? 'Проверяем...' : 'Проверить'}
        </Button>
        {accessResult ? <VehicleAccessResultView result={accessResult} /> : null}
        {historyPlateNumber ? (
          <VehicleFuelingHistoryAccordion
            plateNumber={historyPlateNumber}
            value={historyAccordionValue}
            onValueChange={setHistoryAccordionValue}
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
        {canShowManualOverride && accessResult ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-950">Ручное разрешение</h2>
              <p className="mt-1 text-sm text-slate-500">
                Доступно для старшего смены или администратора АЗС.
              </p>
            </div>
            <CreateManualOverrideForm
              stationId={selectedStationId}
              plateNumber={
                accessResult.normalized_plate_number ||
                normalizePlateNumber(form.getValues('plateNumber'))
              }
              targetDate={getTodayDateInputValue()}
              onCreated={() => {
                checkVehicleAccessMutation.mutate({
                  plateNumber: normalizePlateNumber(form.getValues('plateNumber')),
                  stationId: selectedStationId,
                  checkDate: getTodayDateInputValue(),
                })
              }}
            />
          </div>
        ) : null}
      </form>
    </Form>
  )
}
