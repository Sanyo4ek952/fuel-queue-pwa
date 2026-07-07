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
  PREFERENTIAL_QUEUE_ACTIVE: 'Машина есть в активной льготной очереди мэра.',
  REFUEL_COOLDOWN_ACTIVE: 'После последней заправки ещё не прошёл установленный интервал.',
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

type VehicleAccessResultViewProps = {
  result: VehicleAccessResult
  reasonLabelOverrides?: Partial<Record<VehicleAccessReason, string>>
  blockedReasonOverrides?: Partial<Record<VehicleAccessReason, string>>
}

export function VehicleAccessResultView({
  result,
  reasonLabelOverrides,
  blockedReasonOverrides,
}: VehicleAccessResultViewProps) {
  const blockedTitle = blockedReasonOverrides?.[result.reason]
  const { Icon, title, className } = blockedTitle
    ? {
        Icon: XCircle,
        title: blockedTitle,
        className: 'border-red-200 bg-red-50 text-red-950',
      }
    : getResultTone(result)
  const reason = result.offline_reason ?? result.reason
  const isPreferentialQueueResult = result.reason === 'PREFERENTIAL_QUEUE_ACTIVE'
  const getReasonLabel = (accessReason: VehicleAccessReason) =>
    reasonLabelOverrides?.[accessReason] ?? reasonLabels[accessReason]

  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="font-medium">{title}</p>
            {!isPreferentialQueueResult && !blockedTitle ? (
              <p className="text-sm opacity-80">{getReasonLabel(result.reason)}</p>
            ) : null}
            {result.offline_reason ? (
              <p className="mt-1 text-sm opacity-80">
                Локальный вывод: {reasonLabels[reason]}
              </p>
            ) : null}
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {!isPreferentialQueueResult ? (
              <div>
                <dt className="opacity-70">Номер</dt>
                <dd className="font-semibold tracking-wide">{result.normalized_plate_number}</dd>
              </div>
            ) : null}
            {result.queue_number ? (
              <div>
                <dt className="opacity-70">Общая очередь</dt>
                <dd className="font-semibold">№{result.queue_number}</dd>
              </div>
            ) : null}
            {result.preferential_queue_name ? (
              <div>
                <dt className="opacity-70">Тип очереди</dt>
                <dd className="font-semibold">Льготная очередь</dd>
              </div>
            ) : null}
            {result.category_position ? (
              <div>
                <dt className="opacity-70">Позиция в категории</dt>
                <dd className="font-semibold">№{result.category_position}</dd>
              </div>
            ) : null}
            {result.fuel_category && !isPreferentialQueueResult ? (
              <div>
                <dt className="opacity-70">Очередь</dt>
                <dd className="font-semibold">
                  {categoryLabels[result.fuel_category] ?? result.fuel_category}
                </dd>
              </div>
            ) : null}
            {result.fuel_type ? (
              <div>
                <dt className="opacity-70">Желаемое топливо</dt>
                <dd className="font-semibold">{result.fuel_type}</dd>
              </div>
            ) : null}
            {result.matched_fuel_type && result.matched_fuel_type !== result.fuel_type ? (
              <div>
                <dt className="opacity-70">Доступно к заправке</dt>
                <dd className="font-semibold">{result.matched_fuel_type}</dd>
              </div>
            ) : null}
            {result.effective_liters ? (
              <div>
                <dt className="opacity-70">В расчёте</dt>
                <dd className="font-semibold">{result.effective_liters} л</dd>
              </div>
            ) : null}
            {result.last_fueling_date ? (
              <div>
                <dt className="opacity-70">Последняя заправка</dt>
                <dd className="font-semibold">{result.last_fueling_date}</dd>
              </div>
            ) : null}
            {typeof result.days_since_last_fueling === 'number' ? (
              <div>
                <dt className="opacity-70">Прошло дней</dt>
                <dd className="font-semibold">{result.days_since_last_fueling}</dd>
              </div>
            ) : null}
            {result.next_allowed_date ? (
              <div>
                <dt className="opacity-70">Можно снова с</dt>
                <dd className="font-semibold">{result.next_allowed_date}</dd>
              </div>
            ) : null}
            {typeof result.cooldown_days === 'number' ? (
              <div>
                <dt className="opacity-70">Интервал</dt>
                <dd className="font-semibold">{result.cooldown_days} дн.</dd>
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
