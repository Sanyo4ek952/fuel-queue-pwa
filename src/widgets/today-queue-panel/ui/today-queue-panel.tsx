import { useMemo, useState } from 'react'

import { CloudOff, ListChecks } from 'lucide-react'

import { useDailyLimitOverview } from '@/entities/daily-limit'
import { useCurrentProfile } from '@/entities/profile'
import {
  useTodayQueue,
  type TodayQueueRow,
} from '@/entities/reservation'
import type { CancelReservationFormValues } from '@/features/cancel-reservation'
import { useCancelReservation } from '@/features/cancel-reservation'
import { useLogReservationCall } from '@/features/log-reservation-call'
import {
  type UpdateReservationFuelPreferenceFormValues,
  useUpdateReservationFuelPreference,
} from '@/features/update-reservation-fuel-preference'
import type { FuelQueueCategory, ReservationCallStatus } from '@/shared/constants'
import { getTodayDateInputValue } from '@/shared/lib/date'
import { normalizePlateNumber } from '@/shared/lib/plate-number'
import { canCancelReservation } from '@/shared/lib/permissions'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'

import { categoryLabels } from '../model/labels'
import {
  getCallFilterCounts,
  groupRowsByFuelCategory,
  hasActiveGasolineLimit,
} from '../model/queue-model'
import { formatArrivalAt } from '../model/format'
import {
  ALL_GASOLINE_FILTER,
  categoryOrder,
  type CallFilter,
  type GasolineFuelFilter,
} from '../model/types'
import { QueueFilters } from './queue-filters'
import { QueueRowCard } from './queue-row-card'
import { SummaryTile } from './summary-tile'

function getCallMutationRowId(row: Pick<TodayQueueRow, 'allocation_id' | 'id'>) {
  return row.allocation_id ?? row.id
}

function getReservationMutationRowId(row: Pick<TodayQueueRow, 'queue_entry_id' | 'id'>) {
  return row.queue_entry_id ?? row.id
}

function getQueueActionErrorMessage(error: Error) {
  if (error.message === 'ALLOCATION_NOT_ACTIVE') {
    return 'Назначение уже не активно или недоступно для вашей АЗС. Обновите очередь и попробуйте ещё раз.'
  }

  if (error.message === 'Failed to fetch') {
    return 'Нет связи с сервером. Проверьте подключение или дождитесь офлайн-синхронизации.'
  }

  return error.message
}

export function TodayQueuePanel() {
  const todayDate = getTodayDateInputValue()
  const [plateSearch, setPlateSearch] = useState('')
  const [gasolineFuelFilter, setGasolineFuelFilter] =
    useState<GasolineFuelFilter>(ALL_GASOLINE_FILTER)
  const [callFilter, setCallFilter] = useState<CallFilter>('all')
  const [activeFuelCategory, setActiveFuelCategory] = useState<FuelQueueCategory>('GASOLINE')
  const currentProfileQuery = useCurrentProfile()
  const queue = useTodayQueue({
    plateSearch,
    callFilter,
    gasolineFuelFilter,
  })
  const dailyLimitOverview = useDailyLimitOverview({ date: todayDate, transport: 'api' })
  const logReservationCall = useLogReservationCall()
  const updateReservationFuelPreference = useUpdateReservationFuelPreference()
  const cancelReservation = useCancelReservation()
  const currentRole = currentProfileQuery.data?.role
  const canCancelQueueRows = currentRole ? canCancelReservation(currentRole) : false
  const isFuelPreferenceLockedByGasolineLimit = hasActiveGasolineLimit(
    dailyLimitOverview.data?.category_overviews,
  )
  const normalizedPlateSearch = normalizePlateNumber(plateSearch)
  const rowsMatchingBaseFilters = queue.rows
  const filteredRows = queue.rows
  const callFilterCounts = useMemo(
    () =>
      queue.summary
        ? {
            call: queue.summary.callable_count,
            contacted: queue.summary.contacted_count,
            no_answer: queue.summary.no_answer_count,
          }
        : getCallFilterCounts(rowsMatchingBaseFilters),
    [queue.summary, rowsMatchingBaseFilters],
  )
  const rowsByCategory = groupRowsByFuelCategory(filteredRows)
  const visibleRowsCount = rowsByCategory.reduce((count, category) => count + category.rows.length, 0)
  const summaryTotalCount = queue.summary?.total_count ?? visibleRowsCount
  const callRowsCount = queue.summary?.callable_count ?? callFilterCounts.call
  const contactedRowsCount = queue.summary?.contacted_count ?? callFilterCounts.contacted
  const getCategoryRowsCount = (fuelCategory: (typeof categoryOrder)[number], rowsCount: number) =>
    queue.isOnline ? (queue.summary?.category_counts[fuelCategory] ?? rowsCount) : rowsCount
  const hasActiveFilters =
    normalizedPlateSearch.length > 0 ||
    gasolineFuelFilter !== ALL_GASOLINE_FILTER ||
    callFilter !== 'all'
  const activeCategoryPagination = queue.categoryPagination?.[activeFuelCategory] ?? {
    hasNextPage: queue.hasNextPage,
    isFetchingNextPage: queue.isFetchingNextPage,
    fetchNextPage: queue.fetchNextPage,
  }

  function handleLogCall(row: TodayQueueRow, status: ReservationCallStatus) {
    logReservationCall.mutate({ reservation: row, status })
  }

  function handleUpdateFuelPreference(
    row: TodayQueueRow,
    values: UpdateReservationFuelPreferenceFormValues,
  ) {
    updateReservationFuelPreference.mutate({
      reservationId: row.queue_entry_id ?? row.id,
      fuelType: values.fuelType,
      fuelPreferenceMode: values.fuelPreferenceMode,
      clientMutationId: crypto.randomUUID(),
    })
  }

  function handleCancelReservation(row: TodayQueueRow, values: CancelReservationFormValues) {
    cancelReservation.mutate({
      reservationId: row.queue_entry_id ?? row.id,
      reason: values.reason,
      comment: values.reason === 'OTHER' ? (values.comment ?? '').trim() : null,
      clientMutationId: crypto.randomUUID(),
    })
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-5 text-slate-500" aria-hidden="true" />
            Дневные назначения
          </CardTitle>
          <CardDescription>
            Сохранённое сервером распределение по АЗС, топливу, позициям и времени.
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

          <div className="grid grid-cols-3 gap-2">
            <SummaryTile label="Всего" value={summaryTotalCount} />
            <SummaryTile label="Обзвон" value={callRowsCount} />
            <SummaryTile label="Позвонили" value={contactedRowsCount} />
          </div>

          <QueueFilters
            callFilter={callFilter}
            plateSearch={plateSearch}
            gasolineFuelFilter={gasolineFuelFilter}
            callFilterCounts={callFilterCounts}
            onCallFilterChange={setCallFilter}
            onPlateSearchChange={setPlateSearch}
            onGasolineFuelFilterChange={setGasolineFuelFilter}
          />
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
          <AlertDescription>
            {getQueueActionErrorMessage(logReservationCall.error)}
          </AlertDescription>
        </Alert>
      ) : null}

      {updateReservationFuelPreference.error ? (
        <Alert variant="destructive">
          <AlertTitle>Марка топлива не сохранена</AlertTitle>
          <AlertDescription>
            {getQueueActionErrorMessage(updateReservationFuelPreference.error)}
          </AlertDescription>
        </Alert>
      ) : null}

      {cancelReservation.error ? (
        <Alert variant="destructive">
          <AlertTitle>Запись не удалена</AlertTitle>
          <AlertDescription>{getQueueActionErrorMessage(cancelReservation.error)}</AlertDescription>
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
      visibleRowsCount === 0 &&
      hasActiveFilters ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          По выбранным фильтрам записей нет.
        </div>
      ) : null}

      {visibleRowsCount > 0 ? (
        <Tabs
          value={activeFuelCategory}
          onValueChange={(value) => setActiveFuelCategory(value as FuelQueueCategory)}
          className="space-y-3"
        >
          <TabsList className="grid w-full grid-cols-3">
            {rowsByCategory.map(({ fuelCategory, rows }) => (
              <TabsTrigger key={fuelCategory} value={fuelCategory}>
                {categoryLabels[fuelCategory]} ({getCategoryRowsCount(fuelCategory, rows.length)})
              </TabsTrigger>
            ))}
          </TabsList>
          {rowsByCategory.map(({ fuelCategory, rows }) => {
            return (
              <TabsContent key={fuelCategory} value={fuelCategory} className="space-y-3">
                {rows.length > 0 ? (
                  <>
                    {rows.map((row) => (
                      <QueueRowCard
                        key={row.id}
                        row={row}
                        estimatedArrivalTime={formatArrivalAt(row.arrival_at)}
                        isLoggingCall={
                          logReservationCall.isPending &&
                          (logReservationCall.variables?.reservation
                            ? getCallMutationRowId(logReservationCall.variables.reservation) ===
                              getCallMutationRowId(row)
                            : false)
                        }
                        isUpdatingFuelPreference={
                          updateReservationFuelPreference.isPending &&
                          updateReservationFuelPreference.variables?.reservationId ===
                            getReservationMutationRowId(row)
                        }
                        isFuelPreferenceUpdateUnavailable={!queue.isOnline}
                        isFuelPreferenceLockedByGasolineLimit={
                          isFuelPreferenceLockedByGasolineLimit
                        }
                        canCancel={canCancelQueueRows}
                        isCancelling={
                          cancelReservation.isPending &&
                          cancelReservation.variables?.reservationId ===
                            getReservationMutationRowId(row)
                        }
                        onLogCall={handleLogCall}
                        onUpdateFuelPreference={handleUpdateFuelPreference}
                        onCancel={handleCancelReservation}
                      />
                    ))}
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

      {visibleRowsCount > 0 && activeCategoryPagination.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={activeCategoryPagination.isFetchingNextPage}
          onClick={() => void activeCategoryPagination.fetchNextPage()}
        >
          {activeCategoryPagination.isFetchingNextPage ? 'Загружаем...' : 'Показать еще'}
        </Button>
      ) : null}
    </div>
  )
}
