import type { FuelQueueCategory, QueueFuelType } from '@/shared/constants'

export const categoryOrder: FuelQueueCategory[] = ['GASOLINE', 'DIESEL', 'GAS']
export const ALL_AUTHORS_FILTER = 'all'
export const ALL_GASOLINE_FILTER = 'all'
export const CALL_FILTERS = ['all', 'call', 'contacted', 'no_answer'] as const
export const GASOLINE_FUEL_FILTERS = ['AI_92', 'AI_95', 'AI_100'] as const

export type CallFilter = (typeof CALL_FILTERS)[number]
export type GasolineFuelFilter = typeof ALL_GASOLINE_FILTER | (typeof GASOLINE_FUEL_FILTERS)[number]

export type DailyLimitCategoryLike = {
  fuel_category: FuelQueueCategory
  limit_mode: string
  vehicle_limit: number
  liters_limit: number | null
}

export type FuelingScheduleConfigLike = {
  date: string
  fuel_category: FuelQueueCategory
  start_time: string
  interval_minutes: number
  vehicles_per_interval: number
}

export type TodayQueueScheduleRow = {
  id: string
  ticketNumber: number
  fuelCategory: FuelQueueCategory | null
}

export type TodayQueueCategoryGroup<Row> = {
  fuelCategory: FuelQueueCategory
  rows: Row[]
}

export type QueueFuelFilter = QueueFuelType | typeof ALL_GASOLINE_FILTER
