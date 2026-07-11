import { zodResolver } from '@hookform/resolvers/zod'
import {
  AlertTriangle,
  CheckCircle2,
  Fuel,
  Search,
  XCircle,
} from 'lucide-react'
import { useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { useCurrentProfile } from '@/entities/profile'
import { PlateNumberInput } from '@/entities/vehicle'
import {
  type VehicleAccessResult,
  useCheckVehicleAccess,
} from '@/features/check-vehicle'
import { FUEL_TYPES, type FuelType } from '@/shared/constants'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
import { useProfileStationSelection } from '@/shared/lib/station-selection'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'
import { StationSelectField } from '@/shared/ui/station-select-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

import {
  type CreateFuelingRecordFormInput,
  type CreateFuelingRecordFormValues,
  createFuelingRecordSchema,
} from '../model/schema'
import { useCreateFuelingRecord } from '../model/use-create-fueling-record'

const fuelTypeLabels: Record<FuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
  OTHER: 'Другое',
}

const reasonLabels: Record<string, string> = {
  ACTIVE_RESERVATION: 'Есть активная запись на выбранную АЗС.',
  ALREADY_FUELED: 'Автомобиль уже заправлялся сегодня.',
  DAILY_LIMIT_NOT_OPEN: 'Лимит на выбранную дату не открыт.',
  INVALID_PLATE_NUMBER: 'Госномер не распознан.',
  LITERS_LIMIT_EXCEEDED: 'Запрошенный объём превышает лимит.',
  MANUAL_OVERRIDE_ACTIVE: 'Действует ручное разрешение.',
  NO_GLOBAL_DAILY_LIMIT: 'На сегодня не задан общий лимит топлива.',
  NO_ACTIVE_RESERVATION: 'Нет активной записи на сегодня.',
  NO_DAILY_LIMIT: 'На сегодня не задан лимит по выбранной АЗС.',
  OFFLINE_UNCONFIRMED: 'Offline-решение требует серверной перепроверки.',
  OUTSIDE_TODAY_LIMIT:
    'Автомобиль не попадает в сегодняшний лимит своей очереди.',
  PROFILE_NOT_FOUND: 'Профиль пользователя не найден.',
  PREFERENTIAL_QUEUE_ACTIVE: 'Льготная очередь.',
  RESERVATION_AT_OTHER_STATION:
    'Выбрана не та АЗС. Автомобиль назначен на другую АЗС.',
  RPC_ERROR: 'Не удалось выполнить серверную проверку.',
  STATION_ACCESS_DENIED: 'Нет доступа к выбранной АЗС.',
  VEHICLE_BLOCKED: 'Автомобиль заблокирован.',
}

function canCreateFuelingRecord(
  result?: VehicleAccessResult,
  normalizedPlateNumber?: string,
) {
  if (
    !result ||
    normalizePlateNumber(result.normalized_plate_number) !== normalizedPlateNumber
  ) {
    return false
  }

  if (result.reason === 'ACTIVE_RESERVATION') {
    return Boolean(result.allocation_id)
  }

  return result.status === 'ALLOWED' || result.offline_decision === 'ALLOWED'
}

function getFuelTypeLabel(fuelType: string) {
  return fuelTypeLabels[fuelType as FuelType] ?? fuelType
}

function AccessResultCard({
  result,
  canShowPreferentialQueueName,
}: {
  result: VehicleAccessResult
  canShowPreferentialQueueName: boolean
}) {
  const isAllowed = result.status === 'ALLOWED'
  const isOfflineAllowed = result.offline_decision === 'ALLOWED'
  const isPreferentialQueueResult =
    result.reason === 'PREFERENTIAL_QUEUE_ACTIVE'
  const hasPreferentialQueue =
    isPreferentialQueueResult ||
    Boolean(result.preferential_queue_entry_id || result.preferential_queue_id)
  const preferentialQueueLabel =
    canShowPreferentialQueueName && result.preferential_queue_name
      ? result.preferential_queue_name
      : 'Льготная очередь'
  const Icon =
    isAllowed || isOfflineAllowed
      ? CheckCircle2
      : result.status === 'WARNING'
        ? AlertTriangle
        : XCircle
  const className =
    isAllowed || isOfflineAllowed
      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
      : result.status === 'WARNING'
        ? 'border-amber-200 bg-amber-50 text-amber-950'
        : 'border-red-200 bg-red-50 text-red-950'
  const title =
    isAllowed || isOfflineAllowed
      ? result.offline
        ? 'Локально разрешено'
        : 'Допуск разрешён'
      : result.status === 'WARNING'
        ? 'Нужна перепроверка'
        : 'Допуск запрещён'
  const reason = result.offline_reason ?? result.reason
  const fuelingInstruction =
    (isAllowed || isOfflineAllowed) &&
    result.matched_fuel_type &&
    result.fuel_type
      ? result.matched_fuel_type === result.fuel_type
        ? `Заправить желаемую марку: ${getFuelTypeLabel(result.fuel_type)}.`
        : 'Замена разрешена: желаемой марки нет в лимите, владелец разрешил бензин-замену.'
      : null

  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="font-medium">{title}</p>
            {!isPreferentialQueueResult ? (
              <p className="text-sm opacity-80">{reasonLabels[reason]}</p>
            ) : null}
            {fuelingInstruction ? (
              <p className="mt-1 text-sm font-medium">{fuelingInstruction}</p>
            ) : null}
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="opacity-70">Номер</dt>
              <dd className="font-semibold tracking-wide">
                {result.normalized_plate_number}
              </dd>
            </div>
            {result.queue_number ? (
              <div>
                <dt className="opacity-70">Очередь</dt>
                <dd className="font-semibold">№{result.queue_number}</dd>
              </div>
            ) : null}
            {hasPreferentialQueue ? (
              <div>
                <dt className="opacity-70">Тип очереди</dt>
                <dd className="font-semibold">{preferentialQueueLabel}</dd>
              </div>
            ) : null}
            {result.fuel_type ? (
              <div>
                <dt className="opacity-70">Желаемое топливо</dt>
                <dd className="font-semibold">{result.fuel_type}</dd>
              </div>
            ) : null}
            {result.matched_fuel_type &&
            result.matched_fuel_type !== result.fuel_type ? (
              <div>
                <dt className="opacity-70">Доступно к заправке</dt>
                <dd className="font-semibold">{result.matched_fuel_type}</dd>
              </div>
            ) : null}
            {result.requested_liters ? (
              <div>
                <dt className="opacity-70">По записи</dt>
                <dd className="font-semibold">{result.requested_liters} л</dd>
              </div>
            ) : null}
            {result.effective_liters &&
            result.effective_liters !== result.requested_liters ? (
              <div>
                <dt className="opacity-70">Разрешено</dt>
                <dd className="font-semibold">{result.effective_liters} л</dd>
              </div>
            ) : null}
          </dl>
          {result.offline ? (
            <p className="text-sm opacity-80">
              Фиксация будет сохранена локально со статусом PENDING и
              перепроверена сервером.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function CreateFuelingRecordForm() {
  const currentProfileQuery = useCurrentProfile()
  const currentProfile = currentProfileQuery.data
  const stations = currentProfile?.stations ?? []
  const [selectedStationId, setSelectedStationId] =
    useProfileStationSelection(stations)
  const checkVehicleAccessMutation = useCheckVehicleAccess()
  const createFuelingRecordMutation = useCreateFuelingRecord()
  const form = useForm<
    CreateFuelingRecordFormInput,
    unknown,
    CreateFuelingRecordFormValues
  >({
    resolver: zodResolver(createFuelingRecordSchema),
    mode: 'onBlur',
    defaultValues: {
      plateNumber: '',
      liters: 20,
      fuelType: 'AI_95',
      comment: '',
    },
  })
  const watchedPlateNumber = form.watch('plateNumber')
  const accessResult = checkVehicleAccessMutation.data
  const normalizedPlateNumber = useMemo(
    () => normalizePlateNumber(watchedPlateNumber),
    [watchedPlateNumber],
  )
  const isManualOverrideWithoutReservation =
    accessResult?.reason === 'MANUAL_OVERRIDE_ACTIVE' &&
    !accessResult.reservation_id
  const canSubmitFuelingRecord = canCreateFuelingRecord(
    accessResult,
    normalizedPlateNumber,
  )
  const accessFuelType =
    accessResult?.matched_fuel_type ?? accessResult?.fuel_type
  const fuelSelectOptions = isManualOverrideWithoutReservation
    ? FUEL_TYPES
    : accessFuelType && FUEL_TYPES.includes(accessFuelType as FuelType)
      ? [accessFuelType as FuelType]
      : []
  const isFuelSelectVisible =
    isManualOverrideWithoutReservation ||
    (canSubmitFuelingRecord && fuelSelectOptions.length > 0)
  const isFuelSelectDisabled = !isManualOverrideWithoutReservation

  async function handleCheckVehicle() {
    if (!selectedStationId) {
      return
    }

    const isValid = await form.trigger('plateNumber')

    if (!isValid) {
      return
    }

    const result = await checkVehicleAccessMutation.mutateAsync({
      plateNumber: normalizePlateNumber(form.getValues('plateNumber')),
      stationId: selectedStationId,
      checkDate: getTodayDateInputValue(),
    })

    const allowedLiters = result.effective_liters ?? result.requested_liters

    if (allowedLiters) {
      form.setValue('liters', allowedLiters, { shouldValidate: true })
    }

    const actualFuelType = result.matched_fuel_type ?? result.fuel_type

    if (actualFuelType) {
      form.setValue('fuelType', actualFuelType as FuelType, {
        shouldValidate: true,
      })
    }
  }

  async function handleSubmit(values: CreateFuelingRecordFormValues) {
    if (!selectedStationId || !canSubmitFuelingRecord) {
      return
    }

    await createFuelingRecordMutation.mutateAsync({
      allocationId: accessResult?.allocation_id,
      stationId: selectedStationId,
      plateNumber: values.plateNumber,
      liters: values.liters,
      fuelType: accessResult?.matched_fuel_type
        ? (accessResult.matched_fuel_type as FuelType)
        : accessResult?.fuel_type
          ? (accessResult.fuel_type as FuelType)
          : values.fuelType,
      targetDate: getTodayDateInputValue(),
      fueledAt: new Date().toISOString(),
      comment: values.comment,
      clientMutationId: crypto.randomUUID(),
      forceOffline: Boolean(accessResult?.offline),
    })
  }

  const isCheckDisabled =
    !selectedStationId || checkVehicleAccessMutation.isPending
  const isSubmitDisabled =
    !selectedStationId ||
    !canSubmitFuelingRecord ||
    createFuelingRecordMutation.isPending

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fuel className="size-5 text-slate-500" aria-hidden="true" />
          Фиксация заправки
        </CardTitle>
        <CardDescription>
          Проверка допуска и запись фактического отпуска топлива.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            className="space-y-5"
            onSubmit={form.handleSubmit(handleSubmit)}
          >
            <StationSelectField
              id="fuelingStationId"
              value={selectedStationId}
              stations={stations}
              onValueChange={setSelectedStationId}
              emptyMessage="АЗС не назначена. Фиксация заправки недоступна."
            />

            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <FormItem>
                <FormLabel htmlFor="plateNumber">Госномер</FormLabel>
                <Controller
                  control={form.control}
                  name="plateNumber"
                  render={({ field }) => (
                    <PlateNumberInput
                      id="plateNumber"
                      className="h-11 uppercase"
                      value={field.value}
                      onChange={(value) => {
                        field.onChange(value)
                        form.clearErrors('plateNumber')
                      }}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  )}
                />
                {form.formState.errors.plateNumber ? (
                  <FormMessage>
                    {form.formState.errors.plateNumber.message}
                  </FormMessage>
                ) : null}
              </FormItem>
              <div className="flex sm:pt-5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full gap-2 sm:w-auto"
                  disabled={isCheckDisabled}
                  onClick={handleCheckVehicle}
                >
                  <Search className="size-4" aria-hidden="true" />
                  {checkVehicleAccessMutation.isPending
                    ? 'Проверяем...'
                    : 'Проверить'}
                </Button>
              </div>
            </div>

            {accessResult ? (
              <AccessResultCard
                result={accessResult}
                canShowPreferentialQueueName={currentProfile?.role === 'mayor'}
              />
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel htmlFor="liters">Фактические литры</FormLabel>
                <Input
                  id="liters"
                  type="number"
                  min={1}
                  step="0.01"
                  inputMode="decimal"
                  {...form.register('liters')}
                />
                {form.formState.errors.liters ? (
                  <FormMessage>
                    {form.formState.errors.liters.message}
                  </FormMessage>
                ) : null}
              </FormItem>

              {isFuelSelectVisible ? (
                <FormItem>
                  <FormLabel htmlFor="fuelType">Топливо</FormLabel>
                  <Select
                    disabled={isFuelSelectDisabled}
                    value={form.watch('fuelType')}
                    onValueChange={(value) =>
                      form.setValue('fuelType', value as FuelType, {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger
                      id="fuelType"
                      className="h-10 w-full bg-white"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      {fuelSelectOptions.map((fuelType) => (
                        <SelectItem key={fuelType} value={fuelType}>
                          {fuelTypeLabels[fuelType]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.fuelType ? (
                    <FormMessage>
                      {form.formState.errors.fuelType.message}
                    </FormMessage>
                  ) : null}
                </FormItem>
              ) : null}
            </div>

            <FormItem>
              <FormLabel htmlFor="comment">Комментарий</FormLabel>
              <Input id="comment" {...form.register('comment')} />
              {form.formState.errors.comment ? (
                <FormMessage>
                  {form.formState.errors.comment.message}
                </FormMessage>
              ) : null}
            </FormItem>

            <Button
              type="submit"
              className="h-11 w-full gap-2"
              disabled={isSubmitDisabled}
            >
              <Fuel className="size-4" aria-hidden="true" />
              {createFuelingRecordMutation.isPending
                ? 'Фиксируем...'
                : 'Заправить'}
            </Button>

            {createFuelingRecordMutation.error ? (
              <Alert variant="destructive">
                <AlertTitle>Заправка не зафиксирована</AlertTitle>
                <AlertDescription>
                  {createFuelingRecordMutation.error.message}
                </AlertDescription>
              </Alert>
            ) : null}

            {createFuelingRecordMutation.data ? (
              <Alert
                className={
                  createFuelingRecordMutation.data.sync_status === 'PENDING'
                    ? 'border-amber-200 bg-amber-50 text-amber-950'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-950'
                }
              >
                <AlertTitle>
                  {createFuelingRecordMutation.data.sync_status === 'PENDING'
                    ? 'Заправка ожидает синхронизации'
                    : 'Заправка зафиксирована'}
                </AlertTitle>
                <AlertDescription>
                  {createFuelingRecordMutation.data.liters} л,{' '}
                  {createFuelingRecordMutation.data.fuel_type},{' '}
                  {createFuelingRecordMutation.data.sync_status}.
                </AlertDescription>
              </Alert>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
