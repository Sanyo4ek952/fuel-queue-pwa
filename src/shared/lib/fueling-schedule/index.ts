import type { FuelQueueCategory } from '@/shared/constants'

export type FuelingScheduleConfig = {
  fuelCategory: FuelQueueCategory
  startTime: string
  intervalMinutes: number
  vehiclesPerInterval: number
}

export type FuelingScheduleQueueRow = {
  id: string
  ticketNumber: number
  fuelCategory: FuelQueueCategory | null
}

export type FuelingScheduleEtaRow = {
  id: string
  categoryPosition: number
  arrivalTime: string | null
}

export type FuelingScheduleSummary = {
  fuelCategory: FuelQueueCategory
  queueCount: number
  startTime: string | null
  endTime: string | null
  intervalMinutes: number | null
  vehiclesPerInterval: number | null
}

const MINUTES_PER_DAY = 24 * 60

function parseTimeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)

  if (!match) {
    return null
  }

  const hours = Number(match[1])
  const minutes = Number(match[2])

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null
  }

  return hours * 60 + minutes
}

function formatMinutesAsTime(totalMinutes: number) {
  const dayMinutes = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const hours = Math.floor(dayMinutes / 60)
  const minutes = dayMinutes % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function isUsableSchedule(
  schedule: FuelingScheduleConfig | undefined,
): schedule is FuelingScheduleConfig {
  return Boolean(
    schedule &&
      parseTimeToMinutes(schedule.startTime) !== null &&
      schedule.intervalMinutes > 0 &&
      schedule.vehiclesPerInterval > 0,
  )
}

export function addMinutesToTime(time: string, minutes: number) {
  const startMinutes = parseTimeToMinutes(time)

  if (startMinutes === null) {
    return null
  }

  return formatMinutesAsTime(startMinutes + minutes)
}

export function calculateArrivalTime(
  schedule: FuelingScheduleConfig | undefined,
  categoryPosition: number,
) {
  if (!isUsableSchedule(schedule) || categoryPosition < 1) {
    return null
  }

  const intervalIndex = Math.floor((categoryPosition - 1) / schedule.vehiclesPerInterval)

  return addMinutesToTime(schedule.startTime, intervalIndex * schedule.intervalMinutes)
}

export function calculateFuelingEndTime(
  schedule: FuelingScheduleConfig | undefined,
  queueCount: number,
) {
  if (!isUsableSchedule(schedule)) {
    return null
  }

  if (queueCount <= 0) {
    return schedule.startTime
  }

  const intervalCount = Math.ceil(queueCount / schedule.vehiclesPerInterval)

  return addMinutesToTime(schedule.startTime, intervalCount * schedule.intervalMinutes)
}

export function buildFuelingScheduleEta(
  rows: FuelingScheduleQueueRow[],
  schedules: FuelingScheduleConfig[],
) {
  const schedulesByCategory = new Map(schedules.map((schedule) => [schedule.fuelCategory, schedule]))
  const sortedRows = [...rows].sort(
    (left, right) => left.ticketNumber - right.ticketNumber || left.id.localeCompare(right.id),
  )
  const positionByCategory = new Map<FuelQueueCategory, number>()
  const result = new Map<string, FuelingScheduleEtaRow>()

  sortedRows.forEach((row) => {
    if (!row.fuelCategory) {
      result.set(row.id, {
        id: row.id,
        categoryPosition: 0,
        arrivalTime: null,
      })
      return
    }

    const categoryPosition = (positionByCategory.get(row.fuelCategory) ?? 0) + 1
    positionByCategory.set(row.fuelCategory, categoryPosition)

    result.set(row.id, {
      id: row.id,
      categoryPosition,
      arrivalTime: calculateArrivalTime(schedulesByCategory.get(row.fuelCategory), categoryPosition),
    })
  })

  return result
}

export function buildFuelingScheduleSummary(
  rows: FuelingScheduleQueueRow[],
  schedules: FuelingScheduleConfig[],
  fuelCategories: FuelQueueCategory[],
): FuelingScheduleSummary[] {
  const schedulesByCategory = new Map(schedules.map((schedule) => [schedule.fuelCategory, schedule]))

  return fuelCategories.map((fuelCategory) => {
    const schedule = schedulesByCategory.get(fuelCategory)
    const queueCount = rows.filter((row) => row.fuelCategory === fuelCategory).length

    return {
      fuelCategory,
      queueCount,
      startTime: schedule?.startTime ?? null,
      endTime: calculateFuelingEndTime(schedule, queueCount),
      intervalMinutes: schedule?.intervalMinutes ?? null,
      vehiclesPerInterval: schedule?.vehiclesPerInterval ?? null,
    }
  })
}
