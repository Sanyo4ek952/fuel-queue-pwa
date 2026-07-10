import { useEffect, useMemo, useState } from 'react'

import { CloudOff, ListChecks } from 'lucide-react'

import { useDailyLimitOverview } from '@/entities/daily-limit'
import { useCurrentProfile } from '@/entities/profile'
import {
  useTodayQueue,
  useTodayQueueAuthors,
  type TodayQueueRow,
} from '@/entities/reservation'
import type { CancelReservationFormValues } from '@/features/cancel-reservation'
import { useCancelReservation } from '@/features/cancel-reservation'
import { useLogReservationCall } from '@/features/log-reservation-call'
import { useDailyFuelingSchedule } from '@/features/manage-fueling-schedule'
import {
  type UpdateReservationFuelPreferenceFormValues,
  useUpdateReservationFuelPreference,
} from '@/features/update-reservation-fuel-preference'
import type { FuelQueueCategory, ReservationCallStatus } from '@/shared/constants'
import { getTodayDateInputValue } from '@/shared/lib/date'
import {
  buildFuelingScheduleEta,
  buildFuelingScheduleSummary,
} from '@/shared/lib/fueling-schedule'
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
  toFuelingScheduleConfigs,
  toFuelingScheduleRows,
} from '../model/queue-model'
import {
  ALL_AUTHORS_FILTER,
  ALL_GASOLINE_FILTER,
  categoryOrder,
  type CallFilter,
  type GasolineFuelFilter,
} from '../model/types'
import { FuelingScheduleSummaryPanel } from './fueling-schedule-summary-panel'
import { QueueFilters } from './queue-filters'
import { QueueRowCard } from './queue-row-card'
import { SummaryTile } from './summary-tile'

export function TodayQueuePanel() {
  const todayDate = getTodayDateInputValue()
  const [plateSearch, setPlateSearch] = useState('')
  const [authorFilter, setAuthorFilter] = useState(ALL_AUTHORS_FILTER)
  const [gasolineFuelFilter, setGasolineFuelFilter] =
    useState<GasolineFuelFilter>(ALL_GASOLINE_FILTER)
  const [callFilter, setCallFilter] = useState<CallFilter>('all')
  const [activeFuelCategory, setActiveFuelCategory] = useState<FuelQueueCategory>('GASOLINE')
  const currentProfileQuery = useCurrentProfile()
  const queue = useTodayQueue({
    plateSearch,
    createdByProfileId: authorFilter === ALL_AUTHORS_FILTER ? null : authorFilter,
    callFilter,
    gasolineFuelFilter,
  })
  const authorsQuery = useTodayQueueAuthors({
    plateSearch,
    callFilter,
    gasolineFuelFilter,
  })
  const dailyLimitOverview = useDailyLimitOverview({ date: todayDate })
  const fuelingSchedule = useDailyFuelingSchedule(todayDate)
  const logReservationCall = useLogReservationCall()
  const updateReservationFuelPreference = useUpdateReservationFuelPreference()
  const cancelReservation = useCancelReservation()
  const currentRole = currentProfileQuery.data?.role
  const canCancelQueueRows = currentRole ? canCancelReservation(currentRole) : false
  const isFuelPreferenceLockedByGasolineLimit = hasActiveGasolineLimit(
    dailyLimitOverview.data?.category_overviews,
  )
  const normalizedPlateSearch = normalizePlateNumber(plateSearch)
  const authorOptions = authorsQuery.data ?? []
  const scheduleConfigs = useMemo(
    () => toFuelingScheduleConfigs(fuelingSchedule.data),
    [fuelingSchedule.data],
  )
  const fuelingScheduleRows = useMemo(
    () => toFuelingScheduleRows(queue.rows),
    [queue.rows],
  )
  const etaByReservationId = useMemo(
    () => buildFuelingScheduleEta(fuelingScheduleRows, scheduleConfigs),
    [fuelingScheduleRows, scheduleConfigs],
  )
  const fuelingScheduleSummaries = useMemo(
    () =>
      buildFuelingScheduleSummary(
        fuelingScheduleRows,
        scheduleConfigs,
        categoryOrder,
        queue.isOnline ? queue.summary?.callable_category_counts : undefined,
      ),
    [fuelingScheduleRows, queue.isOnline, queue.summary?.callable_category_counts, scheduleConfigs],
  )
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
    authorFilter !== ALL_AUTHORS_FILTER ||
    gasolineFuelFilter !== ALL_GASOLINE_FILTER ||
    callFilter !== 'all'
  const activeCategoryPagination = queue.categoryPagination?.[activeFuelCategory] ?? {
    hasNextPage: queue.hasNextPage,
    isFetchingNextPage: queue.isFetchingNextPage,
    fetchNextPage: queue.fetchNextPage,
  }

  useEffect(() => {
    if (
      authorFilter !== ALL_AUTHORS_FILTER &&
      authorsQuery.data &&
      !authorsQuery.data.some((author) => author.userId === authorFilter)
    ) {
      setAuthorFilter(ALL_AUTHORS_FILTER)
    }
  }, [authorFilter, authorsQuery.data])

  function handleLogCall(row: TodayQueueRow, status: ReservationCallStatus) {
    logReservationCall.mutate({ reservation: row, status })
  }

  function handleUpdateFuelPreference(
    row: TodayQueueRow,
    values: UpdateReservationFuelPreferenceFormValues,
  ) {
    updateReservationFuelPreference.mutate({
      reservationId: row.id,
      fuelType: values.fuelType,
      fuelPreferenceMode: values.fuelPreferenceMode,
      clientMutationId: crypto.randomUUID(),
    })
  }

  function handleCancelReservation(row: TodayQueueRow, values: CancelReservationFormValues) {
    cancelReservation.mutate({
      reservationId: row.id,
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

          <div className="grid grid-cols-3 gap-2">
            <SummaryTile label="Всего" value={summaryTotalCount} />
            <SummaryTile label="Обзвон" value={callRowsCount} />
            <SummaryTile label="Позвонили" value={contactedRowsCount} />
          </div>

          <FuelingScheduleSummaryPanel summaries={fuelingScheduleSummaries} />

          {fuelingSchedule.error ? (
            <Alert variant="destructive">
              <AlertTitle>Расписание розлива не загружено</AlertTitle>
              <AlertDescription>{fuelingSchedule.error.message}</AlertDescription>
            </Alert>
          ) : null}

          <QueueFilters
            callFilter={callFilter}
            plateSearch={plateSearch}
            gasolineFuelFilter={gasolineFuelFilter}
            authorFilter={authorFilter}
            authorOptions={authorOptions}
            callFilterCounts={callFilterCounts}
            onCallFilterChange={setCallFilter}
            onPlateSearchChange={setPlateSearch}
            onGasolineFuelFilterChange={setGasolineFuelFilter}
            onAuthorFilterChange={setAuthorFilter}
          />
        </CardContent>
      </Card>

      {queue.error ? (
        <Alert variant="destructive">
          <AlertTitle>Очередь не загружена</AlertTitle>
          <AlertDescription>{queue.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {authorsQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Авторы очереди не загружены</AlertTitle>
          <AlertDescription>{authorsQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {logReservationCall.error ? (
        <Alert variant="destructive">
          <AlertTitle>Отметка звонка не сохранена</AlertTitle>
          <AlertDescription>{logReservationCall.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {updateReservationFuelPreference.error ? (
        <Alert variant="destructive">
          <AlertTitle>Марка топлива не сохранена</AlertTitle>
          <AlertDescription>{updateReservationFuelPreference.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {cancelReservation.error ? (
        <Alert variant="destructive">
          <AlertTitle>Запись не удалена</AlertTitle>
          <AlertDescription>{cancelReservation.error.message}</AlertDescription>
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
                        estimatedArrivalTime={
                          etaByReservationId.get(row.id)?.arrivalTime ?? null
                        }
                        isLoggingCall={logReservationCall.isPending}
                        isUpdatingFuelPreference={
                          updateReservationFuelPreference.isPending &&
                          updateReservationFuelPreference.variables?.reservationId === row.id
                        }
                        isFuelPreferenceUpdateUnavailable={!queue.isOnline}
                        isFuelPreferenceLockedByGasolineLimit={
                          isFuelPreferenceLockedByGasolineLimit
                        }
                        canCancel={canCancelQueueRows}
                        isCancelling={
                          cancelReservation.isPending &&
                          cancelReservation.variables?.reservationId === row.id
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
