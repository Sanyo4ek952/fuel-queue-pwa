import type { TodayQueueRow } from '@/entities/reservation'
import { getFuelQueueCategory } from '@/shared/constants'
import type { FuelingScheduleConfig } from '@/shared/lib/fueling-schedule'

import {
  categoryOrder,
  type CallFilter,
  type DailyLimitCategoryLike,
  type FuelingScheduleConfigLike,
  type TodayQueueCategoryGroup,
  type TodayQueueScheduleRow,
} from './types'

export const callFiltersWithCounters = ['call', 'contacted', 'no_answer'] as const

export function isRowCallable(row: TodayQueueRow) {
  return Boolean(row.is_callable_now ?? row.is_within_today_limit)
}

export function matchesCallFilter(row: TodayQueueRow, filter: CallFilter) {
  if (filter === 'all') {
    return true
  }

  if (filter === 'call') {
    return isRowCallable(row) && row.latest_call_status !== 'CONTACTED'
  }

  if (filter === 'contacted') {
    return row.latest_call_status === 'CONTACTED'
  }

  if (filter === 'no_answer') {
    return row.latest_call_status === 'NO_ANSWER'
  }

  return false
}

export function getCallFilterCounts(rows: TodayQueueRow[]) {
  return Object.fromEntries(
    callFiltersWithCounters.map((filter) => [
      filter,
      rows.filter((row) => matchesCallFilter(row, filter)).length,
    ]),
  ) as Record<(typeof callFiltersWithCounters)[number], number>
}

export function groupRowsByFuelCategory<Row extends { fuel_type: string }>(
  rows: Row[],
): TodayQueueCategoryGroup<Row>[] {
  return categoryOrder.map((fuelCategory) => ({
    fuelCategory,
    rows: rows.filter((row) => getFuelQueueCategory(row.fuel_type) === fuelCategory),
  }))
}

export function getVisibleRowsCount<Row>(groups: TodayQueueCategoryGroup<Row>[]) {
  return groups.reduce((count, category) => count + category.rows.length, 0)
}

export function hasActiveGasolineLimit(categoryOverviews: DailyLimitCategoryLike[] | undefined) {
  const gasolineOverview = categoryOverviews?.find((row) => row.fuel_category === 'GASOLINE')

  if (!gasolineOverview) {
    return false
  }

  if (gasolineOverview.limit_mode === 'fuel_liters') {
    return (gasolineOverview.liters_limit ?? 0) > 0
  }

  return gasolineOverview.vehicle_limit > 0
}

export function toFuelingScheduleConfigs(
  rows: FuelingScheduleConfigLike[] | undefined,
): FuelingScheduleConfig[] {
  return (rows ?? []).map(
    (row): FuelingScheduleConfig => ({
      fuelCategory: row.fuel_category,
      date: row.date,
      startTime: row.start_time,
      intervalMinutes: row.interval_minutes,
      vehiclesPerInterval: row.vehicles_per_interval,
    }),
  )
}

export function toFuelingScheduleRows(rows: TodayQueueRow[]): TodayQueueScheduleRow[] {
  return rows.filter(isRowCallable).map((row) => ({
    id: row.id,
    ticketNumber: row.ticket_number,
    fuelCategory: getFuelQueueCategory(row.fuel_type),
  }))
}
