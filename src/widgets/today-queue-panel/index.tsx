import { useEffect, useMemo, useState } from 'react'

import {
  CheckCircle2,
  CloudOff,
  ListChecks,
  Phone,
  PhoneOff,
  RotateCcw,
  XCircle,
} from 'lucide-react'

import { useTodayQueue, type TodayQueueRow } from '@/entities/reservation'
import { useLogReservationCall } from '@/features/log-reservation-call'
import { ROLE_LABELS, type UserRole } from '@/shared/config/roles'
import {
  getFuelQueueCategory,
  type FuelQueueCategory,
  type FuelType,
  type ReservationCallStatus,
} from '@/shared/constants'
import { cn } from '@/shared/lib/utils'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/shared/ui/accordion'
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

const categoryLabels: Record<FuelQueueCategory, string> = {
  GASOLINE: 'Бензин',
  DIESEL: 'Дизель',
  GAS: 'Газ',
}

const categoryOrder: FuelQueueCategory[] = ['GASOLINE', 'DIESEL', 'GAS']
const ALL_AUTHORS_FILTER = 'all'
const QUEUE_PAGE_SIZE = 10
const CALL_FILTERS = ['all', 'call', 'contacted', 'no_answer', 'call_later'] as const

type CallFilter = (typeof CALL_FILTERS)[number]

type QueueAuthorOption = {
  value: string
  label: string
}

function getInitialVisibleCountByCategory(): Record<FuelQueueCategory, number> {
  return {
    GASOLINE: QUEUE_PAGE_SIZE,
    DIESEL: QUEUE_PAGE_SIZE,
    GAS: QUEUE_PAGE_SIZE,
  }
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

  return Array.from(options.values()).sort((left, right) =>
    left.label.localeCompare(right.label),
  )
}

function getPhoneHref(phone: string | null) {
  const normalizedPhone = phone?.replace(/[^\d+]/g, '')

  return normalizedPhone ? `tel:${normalizedPhone}` : null
}

const callFilterLabels: Record<CallFilter, string> = {
  call: 'Обзвон',
  all: 'Все',
  contacted: 'Позвонили',
  no_answer: 'Не дозвонились',
  call_later: 'Перезвонить',
}

const callStatusLabels: Record<ReservationCallStatus, string> = {
  NOT_CALLED: 'Не звонили',
  CONTACTED: 'Позвонили',
  NO_ANSWER: 'Не ответил',
  CALL_LATER: 'Перезвонить',
  WRONG_NUMBER: 'Неверный номер',
}

const callStatusBadgeClasses: Record<ReservationCallStatus, string> = {
  NOT_CALLED: 'border-slate-200 bg-slate-50 text-slate-500',
  CONTACTED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  NO_ANSWER: 'border-amber-200 bg-amber-50 text-amber-800',
  CALL_LATER: 'border-sky-200 bg-sky-50 text-sky-700',
  WRONG_NUMBER: 'border-rose-200 bg-rose-50 text-rose-700',
}

const callStatusButtonClasses: Record<ReservationCallStatus, string> = {
  NOT_CALLED:
    'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700',
  CONTACTED:
    'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800',
  NO_ANSWER:
    'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900',
  CALL_LATER: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800',
  WRONG_NUMBER: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800',
}

function getCalledByLabel(row: TodayQueueRow) {
  return row.latest_called_by_signature_name || row.latest_called_by_full_name || 'Пользователь'
}

function matchesCallFilter(row: TodayQueueRow, filter: CallFilter) {
  if (filter === 'all') {
    return true
  }

  if (filter === 'call') {
    return row.is_within_today_limit && row.latest_call_status !== 'CONTACTED'
  }

  if (filter === 'contacted') {
    return row.latest_call_status === 'CONTACTED'
  }

  if (filter === 'no_answer') {
    return row.latest_call_status === 'NO_ANSWER' || row.latest_call_status === 'WRONG_NUMBER'
  }

  return row.latest_call_status === 'CALL_LATER'
}

function formatCallTime(value: string | null) {
  return value
    ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null
}

function QueueRowCard({
  row,
  displayNumber,
  isLoggingCall,
  onLogCall,
}: {
  row: TodayQueueRow
  displayNumber: number
  isLoggingCall: boolean
  onLogCall: (row: TodayQueueRow, status: ReservationCallStatus) => void
}) {
  const phoneHref = getPhoneHref(row.driver_phone)
  const callActionsDisabled = isLoggingCall || row.is_offline
  const isContacted = row.latest_call_status === 'CONTACTED'
  const hasPendingCallSync = row.latest_call_sync_status === 'PENDING'
  const callTime = formatCallTime(row.latest_called_at)
  const quickCallStatus: ReservationCallStatus = isContacted ? 'NOT_CALLED' : 'CONTACTED'

  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <Accordion type="single" collapsible>
        <AccordionItem value={row.id} className="border-b-0">
          <div className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">
                  {displayNumber}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold tracking-normal text-slate-950">
                    {row.normalized_plate_number || 'Номер не загружен'}
                  </h2>
                  <p className="truncate text-xs text-slate-500">
                    {row.driver_full_name || 'Водитель не указан'}
                  </p>
                  <div className="mt-1 flex max-w-full flex-nowrap gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {row.is_within_today_limit ? (
                      <Badge className="h-4 shrink-0 rounded-md px-1.5 text-[11px]">
                        В лимите
                      </Badge>
                    ) : null}
                    {row.latest_call_status && row.latest_call_status !== 'NOT_CALLED' ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-4 shrink-0 rounded-md px-1.5 text-[11px]',
                          callStatusBadgeClasses[row.latest_call_status],
                        )}
                      >
                        {callStatusLabels[row.latest_call_status]}
                      </Badge>
                    ) : null}
                    {hasPendingCallSync ? (
                      <Badge
                        variant="outline"
                        className="h-4 shrink-0 rounded-md border-amber-200 px-1.5 text-[11px] text-amber-700"
                      >
                        Sync
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Дозвонились"
                disabled={callActionsDisabled}
                className={cn(
                  isContacted
                    ? 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white'
                    : 'border-slate-200 text-slate-400 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700',
                )}
                onClick={() => onLogCall(row, quickCallStatus)}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
              </Button>
              {phoneHref ? (
                <Button asChild variant="outline" size="icon" aria-label="Позвонить">
                  <a href={phoneHref}>
                    <Phone className="size-4" aria-hidden="true" />
                  </a>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Телефон не указан"
                  disabled
                >
                  <Phone className="size-4" aria-hidden="true" />
                </Button>
              )}
              <AccordionTrigger
                className="size-8 flex-none justify-center gap-0 p-0 hover:no-underline"
                aria-label="Открыть детали"
              >
                <span className="sr-only">Открыть детали</span>
              </AccordionTrigger>
            </div>
          </div>

          <AccordionContent className="border-t border-slate-100 px-3 pt-3 pb-3">
            <span className="sr-only">Сведения о записи</span>
            <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
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

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button
                type="button"
                variant="outline"
                className={cn('gap-2', callStatusButtonClasses.CONTACTED)}
                disabled={callActionsDisabled}
                onClick={() => onLogCall(row, 'CONTACTED')}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Дозвонились
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn('gap-2', callStatusButtonClasses.NO_ANSWER)}
                disabled={callActionsDisabled}
                onClick={() => onLogCall(row, 'NO_ANSWER')}
              >
                <PhoneOff className="size-4" aria-hidden="true" />
                Не ответил
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn('gap-2', callStatusButtonClasses.CALL_LATER)}
                disabled={callActionsDisabled}
                onClick={() => onLogCall(row, 'CALL_LATER')}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Перезвонить
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn('gap-2', callStatusButtonClasses.WRONG_NUMBER)}
                disabled={callActionsDisabled}
                onClick={() => onLogCall(row, 'WRONG_NUMBER')}
              >
                <XCircle className="size-4" aria-hidden="true" />
                Неверный
              </Button>
            </div>

            {row.latest_call_status && row.latest_call_status !== 'NOT_CALLED' ? (
              <p className="mt-3 text-xs text-slate-500">
                Отметил: {getCalledByLabel(row)}
                {callTime ? `, ${callTime}` : ''}
              </p>
            ) : null}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </article>
  )
}

export function TodayQueuePanel() {
  const [plateSearch, setPlateSearch] = useState('')
  const [authorFilter, setAuthorFilter] = useState(ALL_AUTHORS_FILTER)
  const [callFilter, setCallFilter] = useState<CallFilter>('all')
  const [visibleCountByCategory, setVisibleCountByCategory] = useState(
    getInitialVisibleCountByCategory,
  )
  const queue = useTodayQueue()
  const logReservationCall = useLogReservationCall()
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
        const matchesCall = matchesCallFilter(row, callFilter)

        return matchesPlate && matchesAuthor && matchesCall
      }),
    [authorFilter, callFilter, normalizedPlateSearch, queue.rows],
  )
  const pendingRows = filteredRows.filter(
    (row) => row.sync_status !== 'SYNCED' || row.latest_call_sync_status === 'PENDING',
  )
  const callRowsCount = queue.rows.filter((row) => matchesCallFilter(row, 'call')).length
  const contactedRowsCount = queue.rows.filter(
    (row) => row.latest_call_status === 'CONTACTED',
  ).length
  const rowsByCategory = categoryOrder.map((fuelCategory) => ({
    fuelCategory,
    rows: filteredRows.filter((row) => getFuelQueueCategory(row.fuel_type) === fuelCategory),
  }))
  const hasActiveFilters =
    normalizedPlateSearch.length > 0 || authorFilter !== ALL_AUTHORS_FILTER || callFilter !== 'all'

  useEffect(() => {
    setVisibleCountByCategory(getInitialVisibleCountByCategory())
  }, [authorFilter, callFilter, normalizedPlateSearch])

  function showMoreRows(fuelCategory: FuelQueueCategory) {
    setVisibleCountByCategory((current) => ({
      ...current,
      [fuelCategory]: current[fuelCategory] + QUEUE_PAGE_SIZE,
    }))
  }

  function handleLogCall(row: TodayQueueRow, status: ReservationCallStatus) {
    logReservationCall.mutate({ reservation: row, status })
  }

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
                Показан локальный снимок. Новые отметки обзвона будут подтверждены после
                синхронизации.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-4 gap-2">
            <SummaryTile label="Всего" value={filteredRows.length} />
            <SummaryTile label="Обзвон" value={callRowsCount} />
            <SummaryTile label="Позвонили" value={contactedRowsCount} />
            <SummaryTile label="Sync" value={pendingRows.length} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {CALL_FILTERS.map((filter) => (
              <Button
                key={filter}
                type="button"
                variant={callFilter === filter ? 'default' : 'outline'}
                className="h-9 px-2 text-xs"
                onClick={() => setCallFilter(filter)}
              >
                {callFilterLabels[filter]}
              </Button>
            ))}
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

      {logReservationCall.error ? (
        <Alert variant="destructive">
          <AlertTitle>Отметка звонка не сохранена</AlertTitle>
          <AlertDescription>{logReservationCall.error.message}</AlertDescription>
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

      {!queue.isLoading &&
      queue.rows.length > 0 &&
      filteredRows.length === 0 &&
      hasActiveFilters ? (
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
          {rowsByCategory.map(({ fuelCategory, rows }) => {
            const visibleCount = visibleCountByCategory[fuelCategory]
            const visibleRows = rows.slice(0, visibleCount)
            const hasMoreRows = rows.length > visibleCount

            return (
              <TabsContent key={fuelCategory} value={fuelCategory} className="space-y-3">
                {rows.length > 0 ? (
                  <>
                    {visibleRows.map((row, index) => (
                      <QueueRowCard
                        key={row.id}
                        row={row}
                        displayNumber={index + 1}
                        isLoggingCall={logReservationCall.isPending}
                        onLogCall={handleLogCall}
                      />
                    ))}
                    {hasMoreRows ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => showMoreRows(fuelCategory)}
                      >
                        Показать еще
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                    В этой очереди нет активных записей.
                  </div>
                )}
              </TabsContent>
            )
          })}
        </Tabs>
      ) : null}
    </div>
  )
}
