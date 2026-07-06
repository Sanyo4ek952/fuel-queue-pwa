import { useMemo, useState } from 'react'

import { CloudOff, ListChecks } from 'lucide-react'

import { useTodayQueue, type TodayQueueRow } from '@/entities/reservation'
import { ROLE_LABELS, type UserRole } from '@/shared/config/roles'
import {
  getFuelQueueCategory,
  type FuelQueueCategory,
  type FuelType,
  type ReservationStatus,
  type SyncStatus,
} from '@/shared/constants'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'

const fuelTypeLabels: Record<FuelType, string> = {
  AI_92: 'АИ-92',
  AI_95: 'АИ-95',
  AI_100: 'АИ-100',
  DIESEL: 'Дизель',
  GAS: 'Газ',
  OTHER: 'Другое',
}

const statusLabels: Record<ReservationStatus, string> = {
  RESERVED: 'Записан',
  ARRIVED: 'Прибыл',
  APPROVED: 'Допущен',
  FUELING: 'Заправка',
  FUELED: 'Заправлен',
  REJECTED: 'Отказ',
  CANCELLED: 'Отменён',
  NO_SHOW: 'Не прибыл',
  EXPIRED: 'Просрочен',
  ERROR: 'Ошибка',
  CONFLICT: 'Конфликт',
}

const syncStatusLabels: Record<SyncStatus, string> = {
  SYNCED: 'SYNCED',
  PENDING: 'PENDING',
  SYNCING: 'SYNCING',
  FAILED: 'FAILED',
  CONFLICT: 'CONFLICT',
}

const statusVariants: Record<ReservationStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  RESERVED: 'secondary',
  ARRIVED: 'outline',
  APPROVED: 'default',
  FUELING: 'default',
  FUELED: 'outline',
  REJECTED: 'destructive',
  CANCELLED: 'outline',
  NO_SHOW: 'outline',
  EXPIRED: 'outline',
  ERROR: 'destructive',
  CONFLICT: 'destructive',
}

const syncStatusVariants: Record<SyncStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  SYNCED: 'outline',
  PENDING: 'secondary',
  SYNCING: 'secondary',
  FAILED: 'destructive',
  CONFLICT: 'destructive',
}

const categoryLabels: Record<FuelQueueCategory, string> = {
  GASOLINE: 'Бензин',
  DIESEL: 'Дизель',
  GAS: 'Газ',
}

const categoryOrder: FuelQueueCategory[] = ['GASOLINE', 'DIESEL', 'GAS']
const ALL_AUTHORS_FILTER = 'all'

type QueueAuthorOption = {
  value: string
  label: string
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  )
}

function formatCreatedBy(row: TodayQueueRow) {
  const roleLabel =
    row.created_by_role && row.created_by_role in ROLE_LABELS
      ? ROLE_LABELS[row.created_by_role as UserRole]
      : 'Пользователь'
  const name = row.created_by_signature_name || row.created_by_full_name

  return name ? `${roleLabel}: ${name}` : 'Автор не указан'
}

function getCreatedByRoleLabel(row: TodayQueueRow) {
  return row.created_by_role && row.created_by_role in ROLE_LABELS
    ? ROLE_LABELS[row.created_by_role as UserRole]
    : 'Пользователь'
}

function getAuthorFilterValue(row: TodayQueueRow) {
  if (row.created_by_profile_id) {
    return row.created_by_profile_id
  }

  return [
    row.created_by_signature_name,
    row.created_by_full_name,
    row.created_by_role,
    'unknown-author',
  ]
    .filter(Boolean)
    .join(':')
}

function getAuthorOptionLabel(row: TodayQueueRow) {
  const name = row.created_by_signature_name || row.created_by_full_name

  return name ? `${name} (${getCreatedByRoleLabel(row)})` : 'Автор не указан'
}

function buildAuthorOptions(rows: TodayQueueRow[]) {
  const options = new Map<string, QueueAuthorOption>()

  rows.forEach((row) => {
    const value = getAuthorFilterValue(row)

    if (!options.has(value)) {
      options.set(value, {
        value,
        label: getAuthorOptionLabel(row),
      })
    }
  })

  return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label))
}

function QueueRowCard({ row }: { row: TodayQueueRow }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">
              {row.queue_number}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-normal text-slate-950">
                {row.normalized_plate_number || 'Номер не загружен'}
              </h2>
              <p className="truncate text-sm text-slate-500">
                {row.driver_full_name || 'Водитель не указан'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={statusVariants[row.status]} className="rounded-md">
            {statusLabels[row.status]}
          </Badge>
          <Badge variant={syncStatusVariants[row.sync_status]} className="rounded-md">
            {syncStatusLabels[row.sync_status]}
          </Badge>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
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
          <dt className="text-slate-500">Телефон</dt>
          <dd className="font-medium text-slate-950">{row.driver_phone || 'Не указан'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Добавил</dt>
          <dd className="font-medium text-slate-950">{formatCreatedBy(row)}</dd>
        </div>
      </dl>

      {row.comment ? <p className="mt-3 text-sm text-slate-500">{row.comment}</p> : null}
    </article>
  )
}

export function TodayQueuePanel() {
  const [plateSearch, setPlateSearch] = useState('')
  const [authorFilter, setAuthorFilter] = useState(ALL_AUTHORS_FILTER)
  const queue = useTodayQueue()
  const normalizedPlateSearch = normalizePlateNumber(plateSearch)
  const authorOptions = useMemo(() => buildAuthorOptions(queue.rows), [queue.rows])
  const filteredRows = useMemo(
    () =>
      queue.rows.filter((row) => {
        const matchesPlate =
          normalizedPlateSearch.length === 0 ||
          row.normalized_plate_number.includes(normalizedPlateSearch)
        const matchesAuthor =
          authorFilter === ALL_AUTHORS_FILTER || getAuthorFilterValue(row) === authorFilter

        return matchesPlate && matchesAuthor
      }),
    [authorFilter, normalizedPlateSearch, queue.rows],
  )
  const pendingRows = filteredRows.filter((row) => row.sync_status !== 'SYNCED')
  const rowsByCategory = categoryOrder.map((fuelCategory) => ({
    fuelCategory,
    rows: filteredRows.filter((row) => getFuelQueueCategory(row.fuel_type) === fuelCategory),
  }))
  const hasActiveFilters = normalizedPlateSearch.length > 0 || authorFilter !== ALL_AUTHORS_FILTER

  return (
    <div className="space-y-4">
      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-5 text-slate-500" aria-hidden="true" />
            Общая очередь
          </CardTitle>
          <CardDescription>
            Единая очередь по всем АЗС, разложенная на бензин, дизель и газ.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!queue.isOnline ? (
            <Alert className="border-amber-200 bg-amber-50 text-amber-950">
              <CloudOff className="size-4" aria-hidden="true" />
              <AlertTitle>Offline-режим</AlertTitle>
              <AlertDescription>
                Показан локальный снимок. Новые записи будут подтверждены после синхронизации.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <SummaryTile label="Всего" value={filteredRows.length} />
            <SummaryTile label="Активные" value={filteredRows.length} />
            <SummaryTile label="Sync" value={pendingRows.length} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="queuePlateSearch" className="text-sm font-medium text-slate-700">
                Поиск по госномеру
              </label>
              <Input
                id="queuePlateSearch"
                value={plateSearch}
                onChange={(event) => setPlateSearch(event.target.value)}
                placeholder="А123ВС777"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="queueAuthorFilter" className="text-sm font-medium text-slate-700">
                Кто добавил
              </label>
              <Select value={authorFilter} onValueChange={setAuthorFilter}>
                <SelectTrigger id="queueAuthorFilter" className="h-8 w-full">
                  <SelectValue placeholder="Все авторы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_AUTHORS_FILTER}>Все авторы</SelectItem>
                  {authorOptions.map((author) => (
                    <SelectItem key={author.value} value={author.value}>
                      {author.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {queue.error ? (
        <Alert variant="destructive">
          <AlertTitle>Очередь не загружена</AlertTitle>
          <AlertDescription>{queue.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {queue.isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Загрузка очереди...
        </div>
      ) : null}

      {!queue.isLoading && queue.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          В общей очереди нет активных записей.
        </div>
      ) : null}

      {!queue.isLoading && queue.rows.length > 0 && filteredRows.length === 0 && hasActiveFilters ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          По выбранным фильтрам записей нет.
        </div>
      ) : null}

      {filteredRows.length > 0 ? (
        <Tabs defaultValue="GASOLINE" className="space-y-3">
          <TabsList className="grid w-full grid-cols-3">
            {rowsByCategory.map(({ fuelCategory, rows }) => (
              <TabsTrigger key={fuelCategory} value={fuelCategory}>
                {categoryLabels[fuelCategory]} ({rows.length})
              </TabsTrigger>
            ))}
          </TabsList>
          {rowsByCategory.map(({ fuelCategory, rows }) => (
            <TabsContent key={fuelCategory} value={fuelCategory} className="space-y-3">
              {rows.length > 0 ? (
                rows.map((row) => <QueueRowCard key={row.id} row={row} />)
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                  В этой очереди нет активных записей.
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      ) : null}
    </div>
  )
}
