import { History, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useCancelledReservations, type CancelledReservation } from '@/entities/reservation'
import { ROLE_LABELS, type UserRole } from '@/shared/config/roles'
import { type FuelType } from '@/shared/constants'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'

const fuelTypeLabels: Record<FuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
  OTHER: 'Другое',
}

const cancelReasonLabels: Record<string, string> = {
  OWNER_CANCELLED: 'Отменено владельцем машины',
  OTHER: 'Другое',
}

function formatRole(role: UserRole | string | null) {
  return role && role in ROLE_LABELS ? ROLE_LABELS[role as UserRole] : 'Пользователь'
}

function formatPerson(name: string, role: UserRole | string | null, signatureName?: string | null) {
  const displayName = signatureName || name

  return displayName ? `${formatRole(role)}: ${displayName}` : 'Не указано'
}

function formatDateTime(value: string | null) {
  return value
    ? new Date(value).toLocaleString('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : 'Не указано'
}

function DeletedReservationCard({ row }: { row: CancelledReservation }) {
  const reason = row.cancel_reason
    ? (cancelReasonLabels[row.cancel_reason] ?? row.cancel_reason)
    : 'Не указана'

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">
              {row.queue_number}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-950">
                {row.normalized_plate_number || 'Номер не указан'}
              </h2>
              <p className="truncate text-xs text-slate-500">
                {row.driver_full_name || 'Водитель не указан'}
              </p>
            </div>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 rounded-md border-rose-200 text-rose-700">
          Удалено
        </Badge>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Дата очереди</dt>
          <dd className="font-medium text-slate-950">{row.date ?? 'Не указана'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Топливо</dt>
          <dd className="font-medium text-slate-950">
            {fuelTypeLabels[row.fuel_type as FuelType] ?? row.fuel_type}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Литры</dt>
          <dd className="font-medium text-slate-950">{row.requested_liters} л</dd>
        </div>
        <div>
          <dt className="text-slate-500">Удалено</dt>
          <dd className="font-medium text-slate-950">{formatDateTime(row.cancelled_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Добавил</dt>
          <dd className="font-medium text-slate-950">
            {formatPerson(
              row.created_by_full_name,
              row.created_by_role,
              row.created_by_signature_name,
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Удалил</dt>
          <dd className="font-medium text-slate-950">
            {formatPerson(
              row.cancelled_by_full_name,
              row.cancelled_by_role,
              row.cancelled_by_signature_name,
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <p className="font-medium text-slate-950">{reason}</p>
        {row.cancel_comment ? <p className="mt-1 text-slate-600">{row.cancel_comment}</p> : null}
      </div>
    </article>
  )
}

export function DeletedReservationsHistoryPanel() {
  const today = getTodayDateInputValue()
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const historyQuery = useCancelledReservations({ dateFrom, dateTo })
  const rows = historyQuery.data ?? []

  return (
    <div className="space-y-4">
      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5 text-slate-500" aria-hidden="true" />
            Удалённые из очереди
          </CardTitle>
          <CardDescription>
            История отменённых записей с причиной удаления и сотрудником, который выполнил действие.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1.5">
              <label htmlFor="deletedDateFrom" className="text-sm font-medium text-slate-700">
                С даты
              </label>
              <Input
                id="deletedDateFrom"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="deletedDateTo" className="text-sm font-medium text-slate-700">
                По дату
              </label>
              <Input
                id="deletedDateTo"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="self-end gap-2"
              disabled={historyQuery.isFetching}
              onClick={() => void historyQuery.refetch()}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Обновить
            </Button>
          </div>
        </CardContent>
      </Card>

      {historyQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>История не загружена</AlertTitle>
          <AlertDescription>{historyQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {historyQuery.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Загружаем историю удалений...
        </div>
      ) : null}

      {!historyQuery.isLoading && rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          За выбранный период удалённых записей нет.
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="space-y-3">
          {rows.map((row) => (
            <DeletedReservationCard key={row.id} row={row} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
