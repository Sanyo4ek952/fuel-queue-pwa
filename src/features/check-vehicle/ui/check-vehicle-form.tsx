import { zodResolver } from '@hookform/resolvers/zod'
import { MapPin, Search } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useForm } from 'react-hook-form'

import { useCurrentProfile } from '@/entities/profile'
import {
  type CheckVehicleFormValues,
  buildVehicleFuelingHistoryViewResult,
  checkVehicleSchema,
  useCheckVehicleAccess,
  useVehicleFuelingHistory,
  VehicleAccessResultView,
  VehicleFuelingHistoryAccordion,
} from '@/features/check-vehicle'
import { CreateManualOverrideForm } from '@/features/create-manual-override'
import {
  getAvailableStations,
  type Station,
  useSelectedStation,
} from '@/features/select-station'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { canCreateManualOverride } from '@/shared/lib/permissions'
import { Button } from '@/shared/ui/button'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

const ALL_STATIONS_VALUE = '__ALL_STATIONS__'
const HISTORY_ACCORDION_VALUE = 'fueling-history'

function CheckStationScopeSelect({
  stations,
  value,
  onValueChange,
}: {
  stations: Station[]
  value: string
  onValueChange: (value: string) => void
}) {
  const triggerId = useId()

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-700" htmlFor={triggerId}>
        АЗС
      </label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={triggerId} className="h-11 w-full bg-white">
          <span className="flex min-w-0 items-center gap-2">
            <MapPin className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
            <SelectValue placeholder="Выберите АЗС" />
          </span>
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectItem value={ALL_STATIONS_VALUE}>Все АЗС</SelectItem>
          {stations.map((station) => (
            <SelectItem key={station.id} value={station.id}>
              {station.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function CheckVehicleForm() {
  const selectedStationId = useSelectedStation((state) => state.selectedStationId)
  const setSelectedStationId = useSelectedStation((state) => state.setSelectedStationId)
  const currentProfileQuery = useCurrentProfile()
  const stations = getAvailableStations(currentProfileQuery.data)
  const [stationScopeValue, setStationScopeValue] = useState(
    selectedStationId || ALL_STATIONS_VALUE,
  )
  const [historyPlateNumber, setHistoryPlateNumber] = useState('')
  const [historyAccordionValue, setHistoryAccordionValue] = useState<string | undefined>()
  const checkVehicleAccessMutation = useCheckVehicleAccess()
  const isHistoryOpen = historyAccordionValue === HISTORY_ACCORDION_VALUE
  const vehicleFuelingHistoryQuery = useVehicleFuelingHistory({
    plateNumber: historyPlateNumber,
    enabled: isHistoryOpen,
  })
  const form = useForm<CheckVehicleFormValues>({
    resolver: zodResolver(checkVehicleSchema),
    defaultValues: {
      plateNumber: '',
    },
  })
  const isAllStationsSelected = stationScopeValue === ALL_STATIONS_VALUE
  const selectedCheckStationId = isAllStationsSelected ? '' : stationScopeValue

  useEffect(() => {
    if (stationScopeValue === ALL_STATIONS_VALUE || !selectedStationId) {
      return
    }

    if (selectedStationId !== stationScopeValue) {
      setStationScopeValue(selectedStationId)
    }
  }, [selectedStationId, stationScopeValue])

  function handleStationScopeChange(value: string) {
    setStationScopeValue(value)
    checkVehicleAccessMutation.reset()
    setHistoryPlateNumber('')
    setHistoryAccordionValue(undefined)

    if (value !== ALL_STATIONS_VALUE) {
      setSelectedStationId(value)
    }
  }

  async function handleSubmit(values: CheckVehicleFormValues) {
    setHistoryPlateNumber(values.plateNumber)
    setHistoryAccordionValue(undefined)

    if (isAllStationsSelected) {
      checkVehicleAccessMutation.reset()
      return
    }

    if (!selectedCheckStationId) {
      setHistoryPlateNumber('')
      return
    }

    await checkVehicleAccessMutation.mutateAsync({
      plateNumber: values.plateNumber,
      stationId: selectedCheckStationId,
      checkDate: getTodayDateInputValue(),
    })
  }

  const isSubmitDisabled =
    (!isAllStationsSelected && !selectedCheckStationId) ||
    checkVehicleAccessMutation.isPending
  const accessResult = checkVehicleAccessMutation.data
  const fuelingHistoryViewResult = buildVehicleFuelingHistoryViewResult(
    vehicleFuelingHistoryQuery.data,
  )
  const currentProfile = currentProfileQuery.data
  const canShowManualOverride =
    Boolean(
      selectedCheckStationId &&
        accessResult &&
        currentProfile &&
        canCreateManualOverride(currentProfile.role),
    ) &&
    (accessResult?.status === 'BLOCKED' || accessResult?.offline_decision === 'BLOCKED') &&
    accessResult?.reason !== 'MANUAL_OVERRIDE_ACTIVE'

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
        <CheckStationScopeSelect
          stations={stations}
          value={stationScopeValue}
          onValueChange={handleStationScopeChange}
        />
        <FormItem>
          <FormLabel htmlFor="plateNumber">Госномер</FormLabel>
          <Input
            id="plateNumber"
            autoComplete="off"
            inputMode="text"
            placeholder="А123ВС"
            className="h-12 text-lg uppercase"
            {...form.register('plateNumber')}
          />
          {form.formState.errors.plateNumber ? (
            <FormMessage>{form.formState.errors.plateNumber.message}</FormMessage>
          ) : null}
        </FormItem>
        <Button type="submit" className="h-11 w-full gap-2" disabled={isSubmitDisabled}>
          <Search className="size-4" aria-hidden="true" />
          {checkVehicleAccessMutation.isPending
            ? 'Проверяем...'
            : 'Проверить'}
        </Button>
        {!isAllStationsSelected && !selectedCheckStationId ? (
          <p className="text-sm text-slate-500">Выберите АЗС перед проверкой.</p>
        ) : null}
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
              stationId={selectedCheckStationId}
              plateNumber={accessResult.normalized_plate_number || form.getValues('plateNumber')}
              targetDate={getTodayDateInputValue()}
              onCreated={() => {
                checkVehicleAccessMutation.mutate({
                  plateNumber: form.getValues('plateNumber'),
                  stationId: selectedCheckStationId,
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
