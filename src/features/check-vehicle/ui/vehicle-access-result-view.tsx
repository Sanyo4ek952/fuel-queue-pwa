import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

import type { VehicleAccessReason, VehicleAccessResult } from '@/features/check-vehicle'

const reasonLabels: Record<VehicleAccessReason, string> = {
  ACTIVE_RESERVATION: 'Есть активная запись в общей очереди.',
  ALREADY_FUELED: 'Автомобиль уже заправлялся сегодня.',
  INVALID_PLATE_NUMBER: 'Госномер не распознан.',
  MANUAL_OVERRIDE_ACTIVE: 'Действует ручное разрешение.',
  NO_GLOBAL_DAILY_LIMIT: 'На сегодня не задан общий лимит топлива.',
  NO_ACTIVE_RESERVATION: 'Нет активной записи в общей очереди.',
  OFFLINE_UNCONFIRMED: 'Offline-проверка требует серверного подтверждения.',
  OUTSIDE_TODAY_LIMIT: 'Автомобиль не попадает в сегодняшний лимит своей очереди.',
  PROFILE_NOT_FOUND: 'Профиль пользователя не найден.',
  RPC_ERROR: 'Не удалось выполнить серверную проверку.',
  STATION_ACCESS_DENIED: 'Нет доступа к выбранной АЗС.',
  VEHICLE_BLOCKED: 'Автомобиль заблокирован.',
}

const categoryLabels: Record<string, string> = {
  GASOLINE: 'Бензин',
  DIESEL: 'Дизель',
  GAS: 'Газ',
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
    title: 'Допуск запрещён',
    className: 'border-red-200 bg-red-50 text-red-950',
  }
}

export function VehicleAccessResultView({ result }: { result: VehicleAccessResult }) {
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
              <p className="mt-1 text-sm opacity-80">
                Локальный вывод: {reasonLabels[reason]}
              </p>
            ) : null}
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="opacity-70">Номер</dt>
              <dd className="font-semibold tracking-wide">{result.normalized_plate_number}</dd>
            </div>
            {result.queue_number ? (
              <div>
                <dt className="opacity-70">Общая очередь</dt>
                <dd className="font-semibold">№{result.queue_number}</dd>
              </div>
            ) : null}
            {result.category_position ? (
              <div>
                <dt className="opacity-70">Позиция в категории</dt>
                <dd className="font-semibold">№{result.category_position}</dd>
              </div>
            ) : null}
            {result.fuel_category ? (
              <div>
                <dt className="opacity-70">Очередь</dt>
                <dd className="font-semibold">
                  {categoryLabels[result.fuel_category] ?? result.fuel_category}
                </dd>
              </div>
            ) : null}
            {result.fuel_type ? (
              <div>
                <dt className="opacity-70">Топливо</dt>
                <dd className="font-semibold">{result.fuel_type}</dd>
              </div>
            ) : null}
            {result.effective_liters ? (
              <div>
                <dt className="opacity-70">В расчёте</dt>
                <dd className="font-semibold">{result.effective_liters} л</dd>
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
