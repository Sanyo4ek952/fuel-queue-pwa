import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, CheckCircle2, Search, XCircle } from 'lucide-react'
import { useForm } from 'react-hook-form'

import {
  type CheckVehicleFormValues,
  checkVehicleSchema,
  useCheckVehicleAccess,
  type VehicleAccessReason,
  type VehicleAccessResult,
} from '@/features/check-vehicle'
import { StationSelect, useSelectedStation } from '@/features/select-station'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { Button } from '@/shared/ui/button'
import { Form, FormItem, FormLabel, FormMessage } from '@/shared/ui/form'
import { Input } from '@/shared/ui/input'

const reasonLabels: Record<VehicleAccessReason, string> = {
  ACTIVE_RESERVATION: 'Есть активная запись на выбранную АЗС.',
  ALREADY_FUELED: 'Автомобиль уже заправлялся сегодня.',
  DAILY_LIMIT_NOT_OPEN: 'Лимит на выбранную дату не открыт.',
  INVALID_PLATE_NUMBER: 'Госномер не распознан.',
  LITERS_LIMIT_EXCEEDED: 'Запрошенный объем превышает лимит на автомобиль.',
  MANUAL_OVERRIDE_ACTIVE: 'Действует ручное разрешение.',
  NO_ACTIVE_RESERVATION: 'Нет активной записи на сегодня.',
  NO_DAILY_LIMIT: 'На сегодня не задан лимит по выбранной АЗС.',
  OFFLINE_UNCONFIRMED: 'Offline-проверка требует серверного подтверждения.',
  PROFILE_NOT_FOUND: 'Профиль пользователя не найден.',
  RESERVATION_AT_OTHER_STATION: 'Запись найдена на другой АЗС.',
  RPC_ERROR: 'Не удалось выполнить серверную проверку.',
  STATION_ACCESS_DENIED: 'Нет доступа к выбранной АЗС.',
  VEHICLE_BLOCKED: 'Автомобиль заблокирован.',
}

function getResultTone(result: VehicleAccessResult) {
  if (result.status === 'ALLOWED') {
    return {
      Icon: CheckCircle2,
      title: 'Допуск разрешен',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    }
  }

  if (result.status === 'WARNING') {
    return {
      Icon: AlertTriangle,
      title: 'Нужно подтверждение',
      className: 'border-amber-200 bg-amber-50 text-amber-950',
    }
  }

  return {
    Icon: XCircle,
    title: 'Допуск запрещен',
    className: 'border-red-200 bg-red-50 text-red-950',
  }
}

function VehicleAccessResultView({ result }: { result: VehicleAccessResult }) {
  const { Icon, title, className } = getResultTone(result)
  const reason = result.offline_reason ?? result.reason

  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-sm opacity-80">{reasonLabels[result.reason]}</p>
            {result.offline_reason ? (
              <p className="mt-1 text-sm opacity-80">Локальный вывод: {reasonLabels[reason]}</p>
            ) : null}
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="opacity-70">Номер</dt>
              <dd className="font-semibold tracking-wide">{result.normalized_plate_number}</dd>
            </div>
            {result.queue_number ? (
              <div>
                <dt className="opacity-70">Очередь</dt>
                <dd className="font-semibold">№{result.queue_number}</dd>
              </div>
            ) : null}
            {result.fuel_type ? (
              <div>
                <dt className="opacity-70">Топливо</dt>
                <dd className="font-semibold">{result.fuel_type}</dd>
              </div>
            ) : null}
            {result.requested_liters ? (
              <div>
                <dt className="opacity-70">Литры</dt>
                <dd className="font-semibold">{result.requested_liters}</dd>
              </div>
            ) : null}
          </dl>
          {result.offline ? (
            <p className="text-sm opacity-80">
              Данные сохранены локально и будут перепроверены сервером после синхронизации.
            </p>
          ) : null}
          {result.error ? <p className="text-sm opacity-80">{result.error}</p> : null}
        </div>
      </div>
    </div>
  )
}

export function CheckVehicleForm() {
  const selectedStationId = useSelectedStation((state) => state.selectedStationId)
  const checkVehicleAccessMutation = useCheckVehicleAccess()
  const form = useForm<CheckVehicleFormValues>({
    resolver: zodResolver(checkVehicleSchema),
    defaultValues: {
      plateNumber: '',
    },
  })

  async function handleSubmit(values: CheckVehicleFormValues) {
    if (!selectedStationId) {
      return
    }

    await checkVehicleAccessMutation.mutateAsync({
      plateNumber: values.plateNumber,
      stationId: selectedStationId,
      checkDate: getTodayDateInputValue(),
    })
  }

  const isSubmitDisabled = !selectedStationId || checkVehicleAccessMutation.isPending

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(handleSubmit)}>
        <StationSelect />
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
          {checkVehicleAccessMutation.isPending ? 'Проверяем...' : 'Проверить'}
        </Button>
        {!selectedStationId ? (
          <p className="text-sm text-slate-500">Выберите АЗС перед проверкой.</p>
        ) : null}
        {checkVehicleAccessMutation.data ? (
          <VehicleAccessResultView result={checkVehicleAccessMutation.data} />
        ) : null}
      </form>
    </Form>
  )
}
